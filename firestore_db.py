import os
import json
import time

class FirestoreService:
    def __init__(self, credentials_path: str = None, project_id: str = "herbania-cloud"):
        self.project_id = project_id
        self.credentials_path = credentials_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        self.db = None
        self.local_mode = True

        # Intentar conectar a Firestore
        try:
            from google.cloud import firestore
            if self.credentials_path and os.path.exists(self.credentials_path):
                self.db = firestore.Client.from_service_account_json(self.credentials_path)
                self.local_mode = False
            else:
                # Comprobar credenciales por defecto de entorno de GCP
                self.db = firestore.Client(project=self.project_id)
                self.local_mode = False
        except Exception:
            # Fallback seguro local si aún no se descargó la clave JSON de GCP
            self.local_mode = True

    def asentar_tickets(self, sede: str, usuario_email: str, tickets: list) -> dict:
        total_importe = 0.0
        for t in tickets:
            try:
                total_importe += float(str(t.get('importe', 0)).replace(',', '.'))
            except Exception:
                pass

        asiento_id = f"ASIENTO-{int(time.time())}"
        timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

        payload = {
            'asiento_id': asiento_id,
            'sede': sede,
            'usuario': usuario_email,
            'fecha_registro': timestamp,
            'num_tickets': len(tickets),
            'total_importe': round(total_importe, 2),
            'tickets': tickets
        }

        # 1. Si Firestore está activo en nube
        if not self.local_mode and self.db:
            try:
                # Colección 'arqueos'
                doc_ref = self.db.collection('arqueos').document(asiento_id)
                doc_ref.set(payload)

                # Colección 'tickets' individual
                batch = self.db.batch()
                for i, t in enumerate(tickets):
                    t_id = f"{asiento_id}-T{i+1:03d}"
                    t_doc = self.db.collection('tickets').document(t_id)
                    t_data = {**t, 'sede': sede, 'asiento_id': asiento_id, 'creado_at': timestamp}
                    batch.set(t_doc, t_data)
                batch.commit()

                return {
                    'success': True,
                    'motor': 'Google Cloud Firestore (Nube)',
                    'asiento_id': asiento_id,
                    'total': payload['total_importe'],
                    'num_tickets': len(tickets)
                }
            except Exception as e:
                # Fallback en caso de error en red
                pass

        # 2. Persistencia local auditada (Fallback)
        db_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'caja_chica_db.json')
        history = []
        if os.path.exists(db_file):
            try:
                with open(db_file, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except Exception:
                history = []
        history.append(payload)
        with open(db_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)

        return {
            'success': True,
            'motor': 'Local Audit Fallback (JSON)',
            'asiento_id': asiento_id,
            'total': payload['total_importe'],
            'num_tickets': len(tickets)
        }
