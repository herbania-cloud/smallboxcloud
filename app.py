from firestore_db import FirestoreService
db_service = FirestoreService()
import hashlib
import os
import json
import socket
import time
import glob
from flask import Flask, render_template, request, jsonify, send_from_directory, session, redirect, url_for
from werkzeug.utils import secure_filename
from ocr_engine import OCREngine

app = Flask(__name__)
app.secret_key = 'SMALLBOXCLOUD_SECRET_KEY_HERBANIA_2026'
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB max

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# ── Auto-limpieza de imágenes temporales > 24h (W2) ──────────────────────────
def _cleanup_old_uploads(folder: str, max_age_hours: int = 24):
    """Elimina PNGs temporales generados por OCR que superen max_age_hours."""
    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for f in glob.glob(os.path.join(folder, '*.png')):
        try:
            if os.path.getmtime(f) < cutoff:
                os.remove(f)
                removed += 1
        except Exception:
            pass
    if removed:
        print(f"[INDIRA] Limpieza automática: {removed} PNG(s) temporales eliminados.")

_cleanup_old_uploads(app.config['UPLOAD_FOLDER'])

ocr = OCREngine()


def _hash_pass(password: str) -> str:
    salt = "SMALLBOXCLOUD_HERBANIA_SALT_"
    return hashlib.sha256((salt + password).encode('utf-8')).hexdigest()

def _get_usuarios():
    db_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'usuarios_db.json')
    if os.path.exists(db_file):
        try:
            with open(db_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return []
    return []

@app.before_request
def require_login():
    # Rutas públicas sin necesidad de login
    public_endpoints = ['login', 'static', 'serve_upload']
    if request.endpoint and request.endpoint in public_endpoints:
        return
    if not session.get('user'):
        return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if session.get('user'):
            return redirect(url_for('index'))
        return render_template('login.html', error=None)

    email = (request.form.get('email') or '').strip().lower()
    password = request.form.get('password') or ''
    delegacion = request.form.get('delegacion') or 'arinaga'
    remember = request.form.get('remember')

    usuarios = _get_usuarios()
    hashed = _hash_pass(password)
    user = next((u for u in usuarios if u['email'].lower() == email and u.get('password_hash') == hashed and u.get('activo', True)), None)

    if not user:
        return render_template('login.html', error="Credenciales inválidas o cuenta inexistente.")

    # Validación de seguridad: delegación prueba solo para admin
    if delegacion == 'prueba' and user.get('rol') != 'admin':
        return render_template('login.html', error="La Delegación Prueba es de acceso exclusivo para Administradores.")

    # Validación de operarios: no pueden operar en sedes ajenas
    if user.get('rol') != 'admin' and delegacion not in user.get('sedes_permitidas', []):
        return render_template('login.html', error=f"Tu usuario solo está autorizado para operar en la sede {user['sedes_permitidas'][0].upper()}.")

    if remember:
        session.permanent = True

    # Guardar en sesión fijando la sede elegida
    session['user'] = {
        'id': user['id'],
        'email': user['email'],
        'nombre': user['nombre'],
        'rol': user['rol'],
        'sedes_permitidas': user['sedes_permitidas'],
        'sede_activa': delegacion
    }
    return redirect(url_for('index'))
@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/api/cambiar_sede', methods=['POST'])
def cambiar_sede():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'No autorizado'}), 401
    
    data = request.get_json() or {}
    nueva_sede = data.get('sede')
    if nueva_sede not in user['sedes_permitidas']:
        return jsonify({'error': 'No tienes permisos para acceder a esta delegación'}), 403

    user['sede_activa'] = nueva_sede
    session['user'] = user
    return jsonify({'success': True, 'sede_activa': nueva_sede})

@app.route('/')
def index():
    return render_template('index.html', usuario=session.get('user'))

@app.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({'error': 'No se enviaron archivos'}), 400

    files = request.files.getlist('files')
    all_results = []

    for file in files:
        if file and file.filename != '':
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)

            doc_results = ocr.process_document(filepath)
            for res in doc_results:
                res['filename'] = filename
                if 'img_path' in res:
                    res['img_url'] = f"/uploads/{os.path.basename(res['img_path'])}"
                all_results.append(res)

    return jsonify({'results': all_results})

@app.route('/analyze_vision', methods=['POST'])
def analyze_vision():
    data = request.get_json()
    img_url = data.get('img_url', '')
    if not img_url:
        return jsonify({'error': 'Ruta de imagen no proporcionada'}), 400

    img_filename = os.path.basename(img_url)
    img_path = os.path.join(app.config['UPLOAD_FOLDER'], img_filename)

    if not os.path.exists(img_path):
        return jsonify({'error': 'Imagen no encontrada en el servidor'}), 404

    ai_result = ocr.analyze_with_vision_ai(img_path)
    return jsonify(ai_result)

@app.route('/save_pattern', methods=['POST'])
def save_pattern():
    data = request.get_json()
    nif = data.get('nif')
    pattern_data = data.get('pattern_data', {})

    if not nif:
        return jsonify({'error': 'NIF no proporcionado'}), 400

    success = ocr.save_ml_pattern(nif, pattern_data)
    if success:
        return jsonify({'message': 'Patrón de aprendizaje guardado con éxito', 'nif': nif})
    else:
        return jsonify({'error': 'No se pudo guardar el patrón'}), 500

@app.route('/crop_ocr', methods=['POST'])
def crop_ocr():
    data = request.get_json()
    img_url = data.get('img_url', '')
    coords = data.get('coords', {})

    if not img_url:
        return jsonify({'error': 'Imagen no especificada'}), 400

    img_filename = os.path.basename(img_url)
    img_path = os.path.join(app.config['UPLOAD_FOLDER'], img_filename)

    blocks = ocr.process_cropped_area(img_path, coords)
    return jsonify({'blocks': blocks})

@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ── Detección de puerto ocupado (C1) ─────────────────────────────────────────
def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) != 0


@app.route('/api/asentar_caja', methods=['POST'])
def asentar_caja():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'No autorizado'}), 401

    data = request.get_json() or {}
    tickets = data.get('tickets', [])
    sede = user.get('sede_activa', 'arinaga')

    if not tickets:
        return jsonify({'error': 'No se recibieron tickets para asentar'}), 400

    res = db_service.asentar_tickets(sede=sede, usuario_email=user['email'], tickets=tickets)
    return jsonify({
        'success': True,
        'mensaje': f"Asiento registrado con éxito en sede {sede.upper()} ({res.get('motor', 'DB')})",
        'asiento_id': res.get('asiento_id'),
        'num_tickets': res.get('num_tickets'),
        'total': res.get('total')
    })

if __name__ == '__main__':
    PORT = 5000
    # Buscar puerto libre si el 5000 está retenido
    while not _is_port_free(PORT) and PORT < 5010:
        PORT += 1

    debug_mode = os.environ.get('INDIRA_DEBUG', '0') == '1'

    print("=" * 60)
    print("  INDIRA - Lector de Facturas Herbania")
    print(f"  URL Local: http://localhost:{PORT}")
    print(f"  Modo debug: {'ACTIVADO' if debug_mode else 'DESACTIVADO'}")
    print("=" * 60)
    app.run(host='0.0.0.0', port=PORT, debug=debug_mode)
