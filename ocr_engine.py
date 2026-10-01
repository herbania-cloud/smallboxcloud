import os
import re
import fitz  # PyMuPDF
from PIL import Image
import pytesseract
import json
import base64
from typing import Dict, List, Any
from datetime import datetime

import shutil

# ── Detección automática de Tesseract (multi-ruta, compatible con cualquier PC) ──
_TESSERACT_CANDIDATE_PATHS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Tesseract-OCR', 'tesseract.exe'),
    r'C:\Program Files\Tesseract-OCR\tesseract.exe',
    r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
    r'C:\Users\{}\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'.format(os.environ.get('USERNAME', '')),
    r'C:\tools\Tesseract-OCR\tesseract.exe',
]

def _find_tesseract() -> str:
    """Busca tesseract.exe en rutas comunes y en el PATH del sistema."""
    # 1. Buscar en PATH del sistema
    in_path = shutil.which('tesseract')
    if in_path:
        return in_path
    # 2. Buscar en rutas candidatas conocidas
    for path in _TESSERACT_CANDIDATE_PATHS:
        if os.path.exists(path):
            return path
    return None

_tesseract_path = _find_tesseract()
if _tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = _tesseract_path
else:
    print("=" * 60)
    print("ERROR CRITICO: Tesseract-OCR no encontrado.")
    print("Instale desde: https://github.com/UB-Mannheim/tesseract/wiki")
    print("Asegurese de marcar 'Add to PATH' durante la instalacion.")
    print("=" * 60)


class OCREngine:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")

    def process_document(self, pdf_path: str) -> List[Dict[str, Any]]:
        """Procesa un PDF/Imagen y devuelve la lista de documentos analizados"""
        doc = fitz.open(pdf_path)
        results = []

        for page_num, page in enumerate(doc):
            pix = page.get_pixmap(dpi=300)
            temp_img_path = f"{pdf_path}_page_{page_num+1}.png"
            pix.save(temp_img_path)

            try:
                img = Image.open(temp_img_path)
                raw_text = pytesseract.image_to_string(img, lang='spa+eng')
                blocks = self._extract_blocks(img)
                
                parsed_data = self._parse_document(img, raw_text, page_num + 1)
                parsed_data['img_path'] = temp_img_path
                parsed_data['blocks'] = blocks
                
                # Aplicar aprendizaje ML previo si existe patrón para este NIF
                parsed_data = self._apply_ml_patterns(parsed_data, temp_img_path)
                
                results.append(parsed_data)
            except Exception as e:
                results.append({
                    'page': page_num + 1,
                    'tipo': 'SALIDA',
                    'fecha': '',
                    'concepto': 'Error de lectura',
                    'codigo': '',
                    'factura': '',
                    'importe': '0.00',
                    'confianza': 'BAJA',
                    'img_path': temp_img_path,
                    'raw_text': str(e)
                })

        return results

    def _parse_document(self, img: Image.Image, text: str, page_num: int) -> Dict[str, Any]:
        text_upper = text.upper()
        
        # 1. Clasificación Tipo (ENTRADA vs SALIDA)
        if 'A35107838' in text_upper or ('CONGELADOS' in text_upper and 'HERBANIA' in text_upper):
            tipo = 'ENTRADA'
        else:
            tipo = 'SALIDA'

        # 2. Extracción de Fecha (dd/mm/yyyy o dd-mm-yyyy)
        fecha = ""
        fecha_match = re.search(r'(\d{1,2}[/\-]\d{1,2}[/\-]\d{4})', text)
        if fecha_match:
            fecha = fecha_match.group(1).replace('-', '/')

        # 3. Extracción de Código de Cliente Herbania (en Entradas) o NIF (en Salidas)
        codigo = ""
        if tipo == 'ENTRADA':
            cod_matches = re.findall(r'\b(2\d{5})\b', text)
            if cod_matches:
                codigo = cod_matches[0]
            else:
                cod_gen = re.search(r'(?:Cliente|NIF:)[^\n]*?\b(\d{5,7})\b', text, re.IGNORECASE)
                if cod_gen:
                    codigo = cod_gen.group(1)
        else:
            nif_match = re.search(r'(?:NIF|CIF)[:\s]+([A-Z0-9\-]+)', text_upper)
            if nif_match:
                codigo = nif_match.group(1)
            else:
                gen_nif = re.search(r'([ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z])', text_upper)
                if gen_nif:
                    codigo = gen_nif.group(1)

        # 4. Extracción del Número de Factura Exacto (ej: 002/G/5543/26, 002/S/151/26)
        factura = ""
        if tipo == 'ENTRADA':
            fact_match = re.search(r'([0-9]{3}/[A-Z]/[0-9]+/[0-9]{2})', text)
            if fact_match:
                factura = fact_match.group(1).strip()
            else:
                fact_herbania = re.search(r'(?:Factura(?:\s+simplificada)?|\bFactura\b)[:\s]+([0-9A-Z/\-_]+)', text, re.IGNORECASE)
                if fact_herbania:
                    factura = fact_herbania.group(1).strip()
        
        if not factura:
            fact_match = re.search(r'(?:Factura|Simplificada|Ticket|F\.OPER)[:\s]+([A-Z0-9\-/]+)', text, re.IGNORECASE)
            if fact_match:
                factura = fact_match.group(1).strip()

        # 5. Extracción de Proveedor / Concepto (Nombre del cliente)
        concepto = ""
        if tipo == 'ENTRADA':
            nom_match = re.search(r'NIF:[^\n]*\n\s*([A-Z\s,]+)\n', text)
            if nom_match and len(nom_match.group(1).strip()) > 3:
                concepto = nom_match.group(1).strip()[:35]
            else:
                lines = [l.strip() for l in text.split('\n') if len(l.strip()) > 3]
                for l in lines:
                    if 'LI,' in l or 'VALENCIA' in l or 'RODRIGUEZ' in l or 'ASOCIACION' in l:
                        concepto = l[:35]
                        break
            if not concepto:
                concepto = "Venta Cliente Herbania"
        else:
            lines = [line.strip() for line in text.split('\n') if len(line.strip()) > 3]
            for line in lines[:8]:
                if any(kw in line.upper() for kw in ['S.A.', 'S.L.', 'AENA', 'REPSOL', 'CEPSA', 'HOTEL', 'RESTAURANTE', 'APARCAMIENTO']):
                    concepto = line[:40]
                    break
            if not concepto and len(lines) > 0:
                concepto = lines[0][:40]

        # 6. EXTRACCIÓN GARANTIZADA DEL IMPORTE TOTAL FACTURA REAL
        importe = "0.00"
        
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        
        # Caso especial Herbania (ENTRADA): Buscar línea "TOTAL FACTURA" y su valor en Euros
        if tipo == 'ENTRADA':
            for idx, line in enumerate(lines):
                if 'TOTAL FACTURA' in line.upper():
                    # Buscar en esta línea y las 3 siguientes
                    sub_lines = lines[idx:min(idx + 4, len(lines))]
                    full_block = " ".join(sub_lines)
                    
                    # Buscar patrón "TOTAL FACTURA 104,15 Euros" o "104,15 Euros" o "104,15"
                    match_euros = re.search(r'(\d+[\.,]\d{2})\s*Euros', full_block, re.IGNORECASE)
                    if match_euros:
                        importe = match_euros.group(1).replace(',', '.')
                        break
                    
                    # Si no dice Euros explícito, buscar la mayor cifra flotante en ese bloque de total
                    amounts = re.findall(r'(\d+[\.,]\d{2})', full_block)
                    if amounts:
                        valid_vals = []
                        for a in amounts:
                            try:
                                v = float(a.replace(',', '.'))
                                if v > 5.0: # Ignorar tasas de IGIC pequeñas como 3.00, 3.03
                                    valid_vals.append(v)
                            except ValueError:
                                continue
                        if valid_vals:
                            importe = f"{max(valid_vals):.2f}"
                            break
            
            # Fallback general para Herbania: buscar patrones con Euros
            if importe == "0.00":
                matches_euros = re.findall(r'(\d+[\.,]\d{2})\s*Euros', text, re.IGNORECASE)
                if matches_euros:
                    # El total suele ser el último o el más alto
                    vals = [float(m.replace(',', '.')) for m in matches_euros]
                    importe = f"{max(vals):.2f}"

        # Caso general (SALIDA / GASTOS TERCEROS)
        if importe == "0.00":
            total_keywords = ['TOTAL FACTURA', 'TOTAL PAGADO', 'IMPORTE TOTAL', 'TOTAL A PAGAR', 'TOTAL:', 'TOTAL']
            for keyword in total_keywords:
                for idx, line in enumerate(lines):
                    if keyword in line.upper():
                        search_lines = lines[idx:min(idx+3, len(lines))]
                        for sl in search_lines:
                            clean = re.sub(r'ES\d+|\d{4}\.\d{4}', '', sl)
                            amounts = re.findall(r'(\d+[,.]\d{2})', clean)
                            for m in reversed(amounts):
                                try:
                                    v = float(m.replace(',', '.'))
                                    if v > 1.0:
                                        importe = f"{v:.2f}"
                                        break
                                except ValueError:
                                    continue
                            if importe != "0.00":
                                break
                    if importe != "0.00":
                        break
                if importe != "0.00":
                    break

        if importe == "0.00":
            # Fallback final: Escanear todas las cifras monetarias del documento
            all_amounts = []
            for line in lines[-12:]:
                clean_line = re.sub(r'ES\d+|\d{4}\.\d{4}', '', line)
                m_list = re.findall(r'(\d+[,\.]\d{2})', clean_line)
                for m in m_list:
                    try:
                        v = float(m.replace(',', '.'))
                        if v > 1.0:
                            all_amounts.append(v)
                    except ValueError:
                        pass
            if all_amounts:
                importe = f"{max(all_amounts):.2f}"

        score = 0
        if fecha: score += 25
        if concepto: score += 25
        if importe != "0.00": score += 30
        if factura or codigo: score += 20

        confianza = 'ALTA' if score >= 75 else ('MEDIA' if score >= 50 else 'BAJA')

        return {
            'page': page_num,
            'tipo': tipo,
            'fecha': fecha,
            'concepto': concepto,
            'codigo': codigo,
            'factura': factura,
            'importe': importe,
            'confianza': confianza,
            'score': score,
            'raw_text': text[:300],
            'full_text': text
        }

    def _extract_blocks(self, img: Image.Image) -> list:
        """Extrae bloques de texto con código [B0x] usando pytesseract data, garantizando la captura de importes"""
        try:
            import pytesseract
            data = pytesseract.image_to_data(img, lang='spa+eng', output_type=pytesseract.Output.DICT)
            blocks = []
            seen_texts = set()
            block_idx = 0
            n = len(data['text'])
            
            for i in range(n):
                txt = str(data['text'][i]).strip()
                conf = int(data['conf'][i]) if str(data['conf'][i]).lstrip('-').isdigit() else -1
                
                if txt and conf >= 30 and len(txt) >= 2:
                    key = txt.upper()
                    if key not in seen_texts:
                        seen_texts.add(key)
                        block_idx += 1
                        blocks.append({
                            'code': f'B{block_idx:02d}',
                            'text': txt,
                            'conf': conf,
                            'x': data['left'][i],
                            'y': data['top'][i],
                            'w': data['width'][i],
                            'h': data['height'][i]
                        })
                        if block_idx >= 60:
                            break
            return blocks
        except Exception:
            return []

    def _load_ml_patterns(self) -> dict:
        """Carga el archivo json de patrones de aprendizaje."""
        pattern_file = os.path.join(os.path.dirname(__file__), 'ml_patterns.json')
        if os.path.exists(pattern_file):
            try:
                with open(pattern_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print("Error cargando ml_patterns.json:", e)
        return {}

    def _normalize_key(self, key: str) -> str:
        """Normaliza una clave alfanumérica eliminando símbolos no alfanuméricos y espacios."""
        if not key:
            return ""
        return re.sub(r'[^A-Z0-9]', '', str(key).upper())

    def save_ml_pattern(self, nif: str, pattern_data: dict) -> bool:
        """Guarda permanentemente un patrón de aprendizaje para un NIF o identificador de proveedor/cliente."""
        clean_nif = str(nif).strip() if nif else ""
        if not clean_nif or clean_nif.upper() == 'DESCONOCIDO':
            return False
        pattern_file = os.path.join(os.path.dirname(__file__), 'ml_patterns.json')
        patterns = self._load_ml_patterns()

        patterns[clean_nif] = {
            'concepto_corregido': pattern_data.get('concepto'),
            'codigo_corregido': pattern_data.get('codigo'),
            'crop_coords': pattern_data.get('crop_coords'),
            'target_field': pattern_data.get('target_field', 'concepto'),
            'ult_actualizacion': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'veces_usado': patterns.get(clean_nif, {}).get('veces_usado', 0) + 1
        }

        try:
            with open(pattern_file, 'w', encoding='utf-8') as f:
                json.dump(patterns, f, ensure_ascii=False, indent=2)
            print(f"[INDIRA ML] Patrón guardado con éxito para {clean_nif}")
            return True
        except Exception as e:
            print("Error guardando ml_patterns.json:", e)
            return False

    def _apply_ml_patterns(self, parsed_data: dict, img_path: str) -> dict:
        """Aplica patrones guardados si el NIF, Código o Concepto del documento coincide o está presente en el texto."""
        tipo = parsed_data.get('tipo', 'SALIDA')
        patterns = self._load_ml_patterns()
        if not patterns:
            return parsed_data

        full_doc_text = (parsed_data.get('full_text') or parsed_data.get('raw_text') or '').upper()
        norm_doc_text = self._normalize_key(full_doc_text)

        patron_encontrado = None
        clave_coincidente = None

        # Candidatos directos a evaluar
        candidates = []
        if parsed_data.get('codigo'):
            candidates.append(str(parsed_data['codigo']).strip())
        if parsed_data.get('nif'):
            candidates.append(str(parsed_data['nif']).strip())
        if parsed_data.get('concepto'):
            candidates.append(str(parsed_data['concepto']).strip())

        # 1. Coincidencia directa con clave o normalizada
        for cand in candidates:
            cand_norm = self._normalize_key(cand)
            if not cand_norm:
                continue
            for pat_key, pat_val in patterns.items():
                pat_key_norm = self._normalize_key(pat_key)
                if cand_norm == pat_key_norm or cand.upper() == pat_key.upper():
                    patron_encontrado = pat_val
                    clave_coincidente = pat_key
                    break
            if patron_encontrado:
                break

        # 2. Búsqueda por presencia en el texto completo escaneado
        if not patron_encontrado:
            for pat_key, pat_val in patterns.items():
                pat_key_norm = self._normalize_key(pat_key)
                if len(pat_key_norm) >= 4 and pat_key_norm in norm_doc_text:
                    patron_encontrado = pat_val
                    clave_coincidente = pat_key
                    break
                elif len(pat_key) >= 4 and pat_key.upper() in full_doc_text:
                    patron_encontrado = pat_val
                    clave_coincidente = pat_key
                    break

        # 3. Aplicación de las reglas aprendidas
        if patron_encontrado:
            print(f"[INDIRA ML] ¡Patrón detectado y aplicado para {tipo}! Clave: {clave_coincidente}")

            # Aplicar concepto a ENTRADA y SALIDA
            if patron_encontrado.get('concepto_corregido'):
                parsed_data['concepto'] = patron_encontrado['concepto_corregido']
                parsed_data['ml_applied'] = True

            # Aplicar código o NIF
            if patron_encontrado.get('codigo_corregido'):
                if tipo == 'ENTRADA':
                    parsed_data['codigo'] = patron_encontrado['codigo_corregido']
                else:
                    parsed_data['codigo'] = ''
                    parsed_data['nif'] = patron_encontrado['codigo_corregido']
                parsed_data['ml_applied'] = True
            elif tipo == 'SALIDA':
                parsed_data['codigo'] = ''

            # Aplicar crop_coords solo si el objetivo es re-leer una zona específica
            crop_coords = patron_encontrado.get('crop_coords')
            target_field = patron_encontrado.get('target_field', 'concepto')
            if crop_coords and os.path.exists(img_path):
                blocks = self.process_cropped_area(img_path, crop_coords)
                if blocks:
                    raw_val = blocks[0].get('text', '').strip()
                    if target_field == 'importe':
                        amounts = re.findall(r'(\d+[\.,]\d{2})', raw_val)
                        if amounts:
                            parsed_data['importe'] = f"{float(amounts[0].replace(',', '.')):.2f}"
                            parsed_data['ml_applied'] = True
                    elif target_field == 'factura' and raw_val:
                        parsed_data['factura'] = raw_val
                        parsed_data['ml_applied'] = True
                    elif target_field == 'fecha' and raw_val:
                        parsed_data['fecha'] = raw_val
                        parsed_data['ml_applied'] = True

            parsed_data['confianza'] = 'ALTA (ML)'
        else:
            if tipo == 'SALIDA':
                parsed_data['codigo'] = ''

        return parsed_data

    def process_cropped_area(self, img_path: str, coords: dict) -> list:
        """Procesa una sub-región de la imagen (coords en %: x_pct, y_pct, w_pct, h_pct) y devuelve bloques acotados + B00 Unificado."""
        try:
            if not os.path.exists(img_path):
                return []
            img = Image.open(img_path)
            width, height = img.size

            x0 = int((coords.get('x_pct', 0) / 100.0) * width)
            y0 = int((coords.get('y_pct', 0) / 100.0) * height)
            w = int((coords.get('w_pct', 100) / 100.0) * width)
            h = int((coords.get('h_pct', 100) / 100.0) * height)
            
            x1 = min(width, x0 + w)
            y1 = min(height, y0 + h)

            if x1 <= x0 or y1 <= y0:
                return []

            crop_img = img.crop((x0, y0, x1, y1))
            
            # Extract full text unificado del recorte completo
            raw_full = pytesseract.image_to_string(crop_img, lang='spa+eng').strip()
            # Limpiar saltos de línea por espacios
            clean_full = " ".join([l.strip() for l in raw_full.split('\n') if l.strip()])

            data = pytesseract.image_to_data(crop_img, lang='spa+eng', output_type=pytesseract.Output.DICT)
            blocks = []
            seen_texts = set()
            block_idx = 0

            # Bloque B00 Unificado (Texto completo recortado)
            if clean_full:
                blocks.append({
                    'code': 'B00',
                    'text': clean_full,
                    'is_full': True,
                    'conf': 95
                })
                seen_texts.add(clean_full.upper())

            n = len(data['text'])
            for i in range(n):
                txt = str(data['text'][i]).strip()
                conf = int(data['conf'][i]) if str(data['conf'][i]).lstrip('-').isdigit() else -1
                if txt and conf >= 20 and len(txt) >= 1:
                    key = txt.upper()
                    if key not in seen_texts:
                        seen_texts.add(key)
                        block_idx += 1
                        blocks.append({
                            'code': f'B{block_idx:02d}',
                            'text': txt,
                            'is_full': False,
                            'conf': conf
                        })

            return blocks
        except Exception as e:
            print("Error en crop_ocr:", e)
            return []

    def analyze_with_vision_ai(self, image_path: str) -> Dict[str, Any]:
        """Extracción forense de comprobantes con Gemini Flash (coste cero)."""
        if not self.api_key:
            return {'error': 'No se configuro GEMINI_API_KEY para Vision por IA.'}

        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            img = Image.open(image_path)

            prompt = """
            Analiza este comprobante o factura de Herbania/Canarias y extrae exactamente en JSON:
            {
              "tipo": "SALIDA",
              "fecha": "YYYY-MM-DD",
              "concepto": "Nombre del proveedor o emisor",
              "nif": "CIF o NIF del emisor",
              "factura": "Numero de factura o ticket",
              "base_imponible": 0.0,
              "tipo_impuesto": 7.0,
              "cuota_impuesto": 0.0,
              "importe": 0.0,
              "categoria": "Categoria de gasto (Ferreteria, Combustible, etc.)",
              "observaciones": "Notas sobre forma de pago o estado"
            }
            """

            model = genai.GenerativeModel(
                model_name='gemini-3.8-flash',
                generation_config={"response_mime_type": "application/json"}
            )
            response = model.generate_content([prompt, img])
            ai_json = json.loads(response.text)
            ai_json['confianza'] = 'ALTA (Gemini Flash)'
            return ai_json

        except Exception as e:
            return {'error': f'Error en Vision AI (Gemini): {str(e)}'}
