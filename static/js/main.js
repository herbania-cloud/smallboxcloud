// ── Toast notifications ──────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Botón de cierre manual
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.className = 'toast-close';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    container.appendChild(toast);
    // Auto-cierre
    setTimeout(() => toast.classList.add('toast-hide'), duration - 300);
    setTimeout(() => toast.remove(), duration);
}

document.addEventListener('DOMContentLoaded', () => {
    // ── Selectores principales ───────────────────────────────────────────────
    const btnLoadBatch     = document.getElementById('btnLoadBatch');
    const btnAddManual     = document.getElementById('btnAddManual');
    const fileInput        = document.getElementById('fileInput');
    const loadingSpinner   = document.getElementById('loadingSpinner');
    const tableBody        = document.getElementById('tableBody');
    const imageViewer      = document.getElementById('imageViewer');
    const imgFilename      = document.getElementById('imgFilename');
    const docCount         = document.getElementById('docCount');
    const btnExportModal   = document.getElementById('btnExportModal');
    const exportModal      = document.getElementById('exportModal');
    const btnCloseModal    = document.getElementById('btnCloseModal');
    const modalTextarea    = document.getElementById('modalTextarea');
    const btnCopyClipboard = document.getElementById('btnCopyClipboard');

    // ── Selectores de la Matriz 5 Filas y Crop Canvas ────────────────────────
    const matrixPanel        = document.getElementById('matrixPanel');
    const matrixEmisorTag    = document.getElementById('matrixEmisorTag');
    const blocksPaletteItems  = document.getElementById('blocksPaletteItems');
    const blocksPaletteTitle  = document.getElementById('blocksPaletteTitle');
    const btnStartCrop       = document.getElementById('btnStartCrop');
    const mlFeedbackBanner   = document.getElementById('mlFeedbackBanner');
    const mlFeedbackText     = document.getElementById('mlFeedbackText');
    const btnSavePattern     = document.getElementById('btnSavePattern');

    const viewerWrapper      = document.getElementById('viewerWrapper');
    const cropCanvas         = document.getElementById('cropCanvas');
    const ctx                = cropCanvas ? cropCanvas.getContext('2d') : null;

    // Navegación entre documentos
    const btnNavUp    = document.getElementById('btnNavUp');
    const btnNavDown  = document.getElementById('btnNavDown');
    const docNavLabel = document.getElementById('docNavLabel');
    const docNavBar   = document.getElementById('docNavBar');

    // Campos de Fila 2 (lectura OCR cruda)
    const mf2 = {
        fecha:    document.getElementById('mf2-fecha'),
        concepto: document.getElementById('mf2-concepto'),
        codigo:   document.getElementById('mf2-codigo'),
        factura:  document.getElementById('mf2-factura'),
        importe:  document.getElementById('mf2-importe'),
    };
    // Campos de Fila 4 (código mapeado)
    const mf4 = {
        fecha:    document.getElementById('mf4-fecha'),
        concepto: document.getElementById('mf4-concepto'),
        codigo:   document.getElementById('mf4-codigo'),
        factura:  document.getElementById('mf4-factura'),
        importe:  document.getElementById('mf4-importe'),
    };
    // Campos de Fila 5 (valor final editable)
    const mf5 = {
        fecha:    document.getElementById('mf5-fecha'),
        concepto: document.getElementById('mf5-concepto'),
        codigo:   document.getElementById('mf5-codigo'),
        factura:  document.getElementById('mf5-factura'),
        importe:  document.getElementById('mf5-importe'),
    };

    let currentResults    = [];
    let activeMatrixIdx   = -1;   // Índice del documento activo en la Matriz
    let activeFocusField  = null; // Campo de F5 enfocado actualmente
    let lockedCropField   = null; // Campo «congelado» cuando el usuario activa el Crop Selector
    let mlPatternLog      = {};   // Memoria de patrones por NIF

    // Variables para el recuadro interactivo (Crop Selector)
    let isDrawing = false;
    let startX = 0, startY = 0;
    let cropCoords = null; // { x_pct, y_pct, w_pct, h_pct }

    // Handler: Asentar en Caja Chica integrado con currentResults
    const btnAsentar = document.getElementById('btnAsentarCaja');
    const selectSede = document.getElementById('selectSede');
    if (btnAsentar) {
        btnAsentar.addEventListener('click', async () => {
            const sede = selectSede ? selectSede.value : 'arinaga';
            // Filtrar solo los documentos marcados con checkbox (o todos si no hay filtro)
            const seleccionados = currentResults.filter(d => d.selected !== false);

            if (!seleccionados || seleccionados.length === 0) {
                alert('⚠️ No hay documentos cargados o seleccionados en la tabla para asentar.');
                return;
            }

            const confirmacion = confirm(`¿Confirmas asentar ${seleccionados.length} documento(s) en la Caja Chica de ${sede.toUpperCase()}?`);
            if (!confirmacion) return;

            btnAsentar.disabled = true;
            btnAsentar.innerText = '⏳ Asentando...';

            try {
                const response = await fetch('/api/asentar_caja', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sede: sede, tickets: seleccionados })
                });
                const result = await response.json();
                if (result.success) {
                    alert(`✅ ¡Éxito! ${result.mensaje}\nTotal Asentado: ${result.total.toFixed(2)} € (${result.num_tickets} tickets)`);
                } else {
                    alert(`❌ Error al asentar: ${result.error || 'Fallo desconocido'}`);
                }
            } catch (err) {
                alert(`❌ Error de conexión: ${err.message}`);
            } finally {
                btnAsentar.disabled = false;
                btnAsentar.innerText = '💾 Asentar en Caja Chica';
            }
        });
    }

    // ── Carga de archivos ────────────────────────────────────────────────────
    btnLoadBatch.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) handleFiles(fileInput.files);
    });

    btnAddManual.addEventListener('click', () => {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        currentResults.push({
            filename: 'Manual', page: 1,
            tipo: 'SALIDA', fecha: `${dd}/${mm}/${yyyy}`,
            concepto: '', codigo: '', factura: '', importe: '0,00',
            img_url: '', blocks: [], confianza: 'MANUAL', selected: true
        });
        renderTable(currentResults);
    });

    function handleFiles(files) {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append('files', files[i]);

        loadingSpinner.style.display = 'block';
        fetch('/upload', { method: 'POST', body: formData })
            .then(r => r.json())
            .then(data => {
                loadingSpinner.style.display = 'none';
                if (data.results && data.results.length > 0) {
                    currentResults = currentResults.concat(data.results);
                    renderTable(currentResults);
                    fileInput.value = '';
                    // Mostrar Matriz del primer documento nuevo
                    const firstNew = currentResults.length - data.results.length;
                    showImage(firstNew);
                    renderMatrix(firstNew);
                } else if (data.error) {
                    alert('Error: ' + data.error);
                }
            })
            .catch(err => {
                loadingSpinner.style.display = 'none';
                alert('Error de conexión con el servidor de lectura.');
                console.error(err);
            });
    }

    // ── Renderizado de la tabla maestra ─────────────────────────────────────
    function renderTable(results) {
        tableBody.innerHTML = '';
        docCount.textContent = `${results.length} documento(s) acumulados`;
        btnExportModal.style.display = results.length > 0 ? 'inline-flex' : 'none';

        results.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.idx = idx;
            if (idx === activeMatrixIdx) tr.classList.add('row-active');
            if (item.selected === undefined) item.selected = true;

            const estadoBadge = item.mlCorrected
                ? '<span style="color:#fbbf24;font-size:0.68rem;">✏️ ML</span>'
                : `<span style="color:${item.confianza === 'ALTA' || item.confianza?.includes('ALTA') ? '#10b981' : '#f59e0b'};font-size:0.68rem;">${item.confianza === 'ALTA' ? '✓' : item.confianza === 'MANUAL' ? '✎' : '~'}</span>`;

            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="doc-checkbox" data-idx="${idx}" ${item.selected !== false ? 'checked' : ''} title="Marque/Desmarque para incluir en la exportación">
                </td>
                <td style="text-align: center;">
                    ${item.img_url
                        ? `<button class="btn btn-sm btn-primary view-btn" data-idx="${idx}">👁️</button>`
                        : '✏️'}
                </td>
                <td>
                    <select class="input-editable tipo-select" data-idx="${idx}">
                        <option value="ENTRADA" ${item.tipo === 'ENTRADA' ? 'selected' : ''}>ENTRADA</option>
                        <option value="SALIDA"  ${item.tipo === 'SALIDA'  ? 'selected' : ''}>SALIDA</option>
                    </select>
                </td>
                <td>
                    <input type="text" class="input-editable fecha-input"    data-idx="${idx}" value="${item.fecha    || ''}" placeholder="dd/mm/yyyy">
                </td>
                <td>
                    <input type="text" class="input-editable codigo-input ${item.tipo === 'SALIDA' ? 'disabled-field' : ''}" data-idx="${idx}" value="${item.codigo   || ''}" placeholder="${item.tipo === 'SALIDA' ? 'N/A (Solo Entradas)' : 'Código Cliente'}" ${item.tipo === 'SALIDA' ? 'readonly' : ''}>
                </td>
                <td>
                    <input type="text" class="input-editable factura-input"  data-idx="${idx}" value="${item.factura  || ''}" placeholder="Factura / Ticket">
                </td>
                <td>
                    <input type="text" class="input-editable concepto-input" data-idx="${idx}" value="${item.concepto || ''}" placeholder="Concepto (Salidas / Comodín)">
                </td>
                <td>
                    <input type="text" class="input-editable importe-input"  data-idx="${idx}" value="${formatSpanish(item.importe)}" style="text-align:right;">
                </td>
                <td style="text-align:center;">${estadoBadge}</td>
            `;
            tableBody.appendChild(tr);
        });

        attachTableListeners();

        // Listeners botones "Ver" → activan Matriz
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                showImage(idx);
                renderMatrix(idx);
            });
        });
    }

    function attachTableListeners() {
        document.querySelectorAll('.doc-checkbox').forEach(el => {
            el.addEventListener('change', e => {
                const idx = parseInt(e.target.dataset.idx);
                currentResults[idx].selected = e.target.checked;
            });
        });

        const checkAllDocs = document.getElementById('checkAllDocs');
        if (checkAllDocs) {
            checkAllDocs.onchange = e => {
                const isChecked = e.target.checked;
                currentResults.forEach(item => item.selected = isChecked);
                document.querySelectorAll('.doc-checkbox').forEach(cb => cb.checked = isChecked);
            };
        }

        document.querySelectorAll('.tipo-select').forEach(el =>
            el.addEventListener('change', e => {
                const idx = parseInt(e.target.dataset.idx);
                currentResults[idx].tipo = e.target.value;
                renderTable(currentResults);
                if (activeMatrixIdx === idx) renderMatrix(idx);
            }));

        document.querySelectorAll('.codigo-input').forEach(el => {
            el.addEventListener('click', e => {
                const idx = parseInt(e.target.dataset.idx);
                if (currentResults[idx].tipo === 'SALIDA') {
                    showToast('⚠️ El campo Código es exclusivo de ENTRADAS. Cambie el Tipo si necesita asignar un código.', 'warn');
                }
            });
            el.addEventListener('input', e => {
                const idx = parseInt(e.target.dataset.idx);
                currentResults[idx].codigo = e.target.value;
            });
        });

        document.querySelectorAll('.fecha-input').forEach(el =>
            el.addEventListener('input', e => { currentResults[e.target.dataset.idx].fecha = e.target.value; }));
        document.querySelectorAll('.concepto-input').forEach(el =>
            el.addEventListener('input', e => { currentResults[e.target.dataset.idx].concepto = e.target.value; }));
        document.querySelectorAll('.factura-input').forEach(el =>
            el.addEventListener('input', e => { currentResults[e.target.dataset.idx].factura = e.target.value; }));
        document.querySelectorAll('.importe-input').forEach(el =>
            el.addEventListener('input', e => {
                let val = e.target.value.replace('.', ',');
                e.target.value = val;
                currentResults[e.target.dataset.idx].importe = val;
            }));
    }

    // ── MATRIZ DE 5 FILAS ────────────────────────────────────────────────────
    function renderMatrix(idx) {
        const item = currentResults[idx];
        if (!item) return;

        activeMatrixIdx = idx;
        matrixPanel.classList.add('visible');

        // Actualizar barra de navegación
        if (docNavBar && currentResults.length > 0) {
            docNavBar.style.display = 'flex';
            docNavLabel.textContent = `${idx + 1} / ${currentResults.length}`;
        }

        // Resaltar fila activa en la tabla (quitar clase de todas y añadir a la activa)
        document.querySelectorAll('#tableBody tr').forEach(tr => tr.classList.remove('row-active'));
        const activeRow = document.querySelector(`#tableBody tr[data-idx="${idx}"]`);
        if (activeRow) {
            activeRow.classList.add('row-active');
            activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        matrixEmisorTag.textContent = item.codigo
            ? `Emisor / Cliente: ${item.concepto || ''} (${item.codigo})`
            : `Tipo: ${item.tipo} | ${item.concepto || 'Sin emisor'}`;

        // FILA 2: Lectura cruda (Nuevo orden: fecha, codigo, factura, concepto, importe)
        mf2.fecha.textContent    = item.fecha    || '—';
        mf2.codigo.textContent   = item.codigo   || '—';
        mf2.factura.textContent  = item.factura  || '—';
        mf2.concepto.textContent = item.concepto || '—';
        mf2.importe.textContent  = formatSpanish(item.importe);

        // Clic F2 -> Transferir a F5
        [
            ['fecha', item.fecha], ['codigo', item.codigo],
            ['factura', item.factura], ['concepto', item.concepto],
            ['importe', formatSpanish(item.importe)]
        ].forEach(([field, val]) => {
            mf2[field].onclick = () => {
                if (field === 'codigo' && item.tipo === 'SALIDA') {
                    alert('⚠️ Documento configurado como SALIDA: Cambie primero el tipo a ENTRADA para asignar un Código de cliente.');
                    return;
                }
                mf5[field].value = val || '';
                mf5[field].classList.add('edited');
                syncF5toResults(idx);
            };
        });

        // FILA 4: Códigos por defecto
        mf4.fecha.textContent    = '[B01]';
        mf4.codigo.textContent   = item.tipo === 'SALIDA' ? '[N/A]' : '[B02]';
        mf4.factura.textContent  = '[B03]';
        mf4.concepto.textContent = '[B04]';
        mf4.importe.textContent  = '[B05]';

        // FILA 5: Rellenar con valores del documento activo
        // REGLA FORENSE: código de cliente es EXCLUSIVO de ENTRADAS — limpiar si es SALIDA
        if (item.tipo === 'SALIDA') item.codigo = '';
        mf5.fecha.value    = item.fecha    || '';
        mf5.codigo.value   = item.codigo   || '';
        mf5.factura.value  = item.factura  || '';
        mf5.concepto.value = item.concepto || '';
        mf5.importe.value  = formatSpanish(item.importe);

        // Bloqueo visual de Código en Fila 5 si es SALIDA
        if (item.tipo === 'SALIDA') {
            mf5.codigo.classList.add('disabled-field');
            mf5.codigo.readOnly = true;
            mf5.codigo.placeholder = 'N/A (Solo Entradas)';
        } else {
            mf5.codigo.classList.remove('disabled-field');
            mf5.codigo.readOnly = false;
            mf5.codigo.placeholder = 'Código Cliente';
        }

        Object.keys(mf5).forEach(f => mf5[f].classList.remove('edited'));

        resetBlocksPalette();

        // ── LISTENERS F5 con bloqueo explícito ──
        Object.keys(mf5).forEach(field => {
            const capturedIdx = idx;
            mf5[field].onfocus = () => {
                if (field === 'codigo' && currentResults[capturedIdx].tipo === 'SALIDA') {
                    showToast('⚠️ Campo Código desactivado en SALIDA. Cambie el Tipo a ENTRADA para asignar un código de cliente.', 'warn');
                    mf5[field].blur(); // quitar el foco inmediatamente
                    return;
                }
                Object.keys(mf5).forEach(f => mf5[f].classList.remove('focused-field'));
                mf5[field].classList.add('focused-field');
                activeFocusField = mf5[field];
            };
            mf5[field].oninput = () => {
                if (field === 'importe') {
                    mf5[field].value = mf5[field].value.replace('.', ',');
                }
                mf5[field].classList.add('edited');
                syncF5toResults(capturedIdx);
                checkMLFeedback(capturedIdx);
            };
        });

        // Por defecto, enfocar la casilla de concepto/proveedor si no hay foco previo
        if (!activeFocusField) {
            Object.keys(mf5).forEach(f => mf5[f].classList.remove('focused-field'));
            mf5.concepto.classList.add('focused-field');
            activeFocusField = mf5.concepto;
        }

        mlFeedbackBanner.classList.remove('visible');
        btnSavePattern.onclick = () => saveMLPattern(idx);
    }

    function resetBlocksPalette() {
        blocksPaletteTitle.textContent = '🔍 Área Seleccionada: Dibuje un recuadro sobre la factura a la izquierda';
        blocksPaletteItems.innerHTML = '<span style="color: #64748b; font-size: 0.72rem; font-style: italic;">Sin recuadro activo. Haga clic en <b>"🎯 Seleccionar Área"</b> o dibuje un rectángulo sobre el número a la izquierda.</span>';
    }

    function syncF5toResults(idx) {
        if (idx < 0 || idx >= currentResults.length) return;
        const item = currentResults[idx];

        // Actualizar solo el objeto en memoria (NO re-renderizar la tabla completa)
        item.fecha    = mf5.fecha.value;
        item.concepto = mf5.concepto.value;
        item.codigo   = mf5.codigo.value;
        item.factura  = mf5.factura.value;
        item.importe  = mf5.importe.value;
        item.mlCorrected = true;

        // Actualizar únicamente las celdas de ESA fila en la tabla (sin re-render global)
        const rows = tableBody.querySelectorAll('tr');
        if (rows[idx]) {
            const inputs = rows[idx].querySelectorAll('input.input-editable');
            inputs.forEach(inp => {
                const field = inp.classList[1]?.replace('-input','');
                if (field && item[field] !== undefined) {
                    // Solo actualizar si el input no está enfocado actualmente
                    if (document.activeElement !== inp) {
                        inp.value = field === 'importe' ? formatSpanish(item.importe) : (item[field] || '');
                    }
                }
            });
        }
    }

    function checkMLFeedback(idx) {
        const item = currentResults[idx];
        const hasChanges = ['fecha','concepto','codigo','factura','importe'].some(f => mf5[f].classList.contains('edited'));
        if (hasChanges) {
            const ident = (item.tipo === 'ENTRADA' ? (item.codigo || item.concepto) : (item.nif || item.concepto || item.codigo)) || 'DESCONOCIDO';
            mlFeedbackText.innerHTML = `🧠 <b>ML Feedback:</b> Corrección detectada para <b>${ident}</b>. Guarda el patrón para recordar este proveedor/cliente.`;
            mlFeedbackBanner.classList.add('visible');
        } else {
            mlFeedbackBanner.classList.remove('visible');
        }
    }

    function saveMLPattern(idx) {
        const item = currentResults[idx];
        let identifier = (item.tipo === 'ENTRADA' ? (item.codigo || item.concepto) : (item.nif || item.concepto || item.codigo));
        if (!identifier || !identifier.trim() || identifier === 'DESCONOCIDO') {
            identifier = item.concepto || 'DESCONOCIDO';
        }
        identifier = identifier.trim();
        
        const patternData = {
            concepto: item.concepto,
            codigo: (item.tipo === 'ENTRADA' ? item.codigo : (item.nif || item.codigo || '')),
            crop_coords: cropCoords,
            target_field: 'concepto'
        };

        btnSavePattern.textContent = '⏳ Guardando...';
        btnSavePattern.disabled = true;

        fetch('/save_pattern', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nif: identifier, pattern_data: patternData })
        })
        .then(r => r.json())
        .then(data => {
            btnSavePattern.disabled = false;
            if (data.message) {
                btnSavePattern.textContent = '✅ Patrón aprendido y guardado';
                btnSavePattern.style.backgroundColor = '#10b981';
                setTimeout(() => {
                    btnSavePattern.textContent = '💾 Guardar Patrón';
                    btnSavePattern.style.backgroundColor = '';
                }, 3000);
            } else {
                alert('Error al guardar patrón: ' + (data.error || 'Desconocido'));
                btnSavePattern.textContent = '💾 Guardar Patrón';
            }
        })
        .catch(err => {
            btnSavePattern.disabled = false;
            btnSavePattern.textContent = '💾 Guardar Patrón';
            console.error(err);
            alert('Error de conexión al guardar patrón ML.');
        });
    }

    // ── CANVASES & SELECCIÓN DE ÁREA SOBRE EL DOCUMENTO (CROP SELECTOR) ────────
    function showImage(idx) {
        const item = currentResults[idx];
        if (item && item.img_url) {
            imageViewer.onload = () => adjustCanvasSize();
            imageViewer.src = item.img_url;
            // Calcular total de páginas del mismo archivo
            const totalPages = currentResults.filter(r => r.filename === item.filename).length;
            const pageNum = currentResults
                .filter(r => r.filename === item.filename)
                .findIndex(r => r === item) + 1;
            imgFilename.textContent = `${item.filename}  —  Pág. ${pageNum} de ${totalPages}`;
        }
    }

    function adjustCanvasSize() {
        if (!imageViewer || !cropCanvas) return;
        cropCanvas.width  = imageViewer.clientWidth;
        cropCanvas.height = imageViewer.clientHeight;
    }

    window.addEventListener('resize', adjustCanvasSize);

    if (cropCanvas) {
        cropCanvas.addEventListener('mousedown', e => {
            if (activeMatrixIdx < 0) return;
            const rect = cropCanvas.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            isDrawing = true;
        });

        cropCanvas.addEventListener('mousemove', e => {
            if (!isDrawing) return;
            const rect = cropCanvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
            
            const w = currentX - startX;
            const h = currentY - startY;
            ctx.fillRect(startX, startY, w, h);
            ctx.strokeRect(startX, startY, w, h);
        });

        cropCanvas.addEventListener('mouseup', e => {
            if (!isDrawing) return;
            isDrawing = false;
            const rect = cropCanvas.getBoundingClientRect();
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;

            const x = Math.min(startX, endX);
            const y = Math.min(startY, endY);
            const w = Math.abs(endX - startX);
            const h = Math.abs(endY - startY);

            if (w < 10 || h < 10) return; // Ignorar clics simples no arrastrados

            // Convertir a porcentajes relativas (x_pct, y_pct, w_pct, h_pct)
            const cWidth  = cropCanvas.width;
            const cHeight = cropCanvas.height;

            cropCoords = {
                x_pct: (x / cWidth) * 100,
                y_pct: (y / cHeight) * 100,
                w_pct: (w / cWidth) * 100,
                h_pct: (h / cHeight) * 100
            };

            // Ejecutar OCR focalizado en esa zona recortada
            fetchCroppedOCR(cropCoords);
        });
    }

    if (btnStartCrop) {
        btnStartCrop.addEventListener('click', () => {
            if (activeMatrixIdx < 0) {
                showToast('Primero active o cargue un documento de la lista.', 'warn');
                return;
            }
            // Congelar el campo activo ANTES de que el clic en el botón lo pierda
            lockedCropField = activeFocusField || mf5.factura;
            // Resaltar visualmente el campo «objetivo» del crop
            Object.keys(mf5).forEach(f => mf5[f].classList.remove('crop-target'));
            lockedCropField.classList.add('crop-target');

            // Mostrar instrucciones solo la primera vez
            const hasSeenTutorial = localStorage.getItem('indira_crop_tutorial_seen');
            if (!hasSeenTutorial) {
                showToast('Mantenga el ratón presionado sobre la factura y arrastre un recuadro sobre el número o texto que desea capturar.', 'info', 6000);
                localStorage.setItem('indira_crop_tutorial_seen', 'true');
            } else {
                const fieldName = Object.keys(mf5).find(k => mf5[k] === lockedCropField) || 'campo';
                showToast(`📌 Recuadro dirigido a: ${fieldName.toUpperCase()}`, 'info', 3000);
            }
        });
    }

    function fetchCroppedOCR(coords) {
        const item = currentResults[activeMatrixIdx];
        if (!item || !item.img_url) return;

        blocksPaletteTitle.textContent = '⏳ Leyendo área seleccionada...';
        blocksPaletteItems.innerHTML = '<span style="color:#38bdf8;font-size:0.72rem;">Procesando recuadro...</span>';

        fetch('/crop_ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ img_url: item.img_url, coords: coords })
        })
        .then(r => r.json())
        .then(data => {
            const blocks = data.blocks || [];
            blocksPaletteTitle.textContent = `🎯 Bloques detectados en el área seleccionada (${blocks.length}):`;
            blocksPaletteItems.innerHTML = '';

            if (blocks.length === 0) {
                blocksPaletteItems.innerHTML = '<span style="color:#f87171;font-size:0.72rem;">No se detectó texto claro en la selección. Intente arrastrar un cuadro más amplio.</span>';
                return;
            }

            blocks.forEach(b => {
                const pill = document.createElement('span');
                pill.className = `block-pill ${b.is_full ? 'full-pill' : ''}`;
                pill.textContent = b.is_full ? `[B00 - TODO EL RECORTE] ${b.text}` : `[${b.code}] ${b.text}`;
                pill.title = b.is_full ? 'Haz clic para copiar toda la frase/línea recortada de una vez' : 'Haz clic para asignar o concatenar este bloque';
                
                pill.addEventListener('click', () => {
                    // Usar siempre el campo «congelado» al abrir Crop. Si no hay ninguno, usar el activo o concepto.
                    const targetField = lockedCropField || activeFocusField || mf5.concepto;

                    let cleanText = b.text.trim();
                    if (targetField === mf5.importe && !b.is_full) cleanText = formatSpanish(cleanText);

                    // Si es B00 (Full) o la casilla está vacía → reemplaza. Si ya hay texto → concatena.
                    if (b.is_full || !targetField.value.trim()) {
                        targetField.value = cleanText;
                    } else {
                        targetField.value = targetField.value.trim() + ' ' + cleanText;
                    }

                    targetField.classList.add('edited');
                    targetField.classList.remove('crop-target'); // Quitar resaltado crop al pegar
                    lockedCropField = null; // Liberar el bloqueo tras pegar

                    // Actualizar código en Fila 4 para trazabilidad
                    if (targetField === mf5.importe)  mf4.importe.textContent  = `[${b.code}]`;
                    if (targetField === mf5.factura)  mf4.factura.textContent  = `[${b.code}]`;
                    if (targetField === mf5.codigo)   mf4.codigo.textContent   = `[${b.code}]`;
                    if (targetField === mf5.concepto) mf4.concepto.textContent = `[${b.code}]`;
                    if (targetField === mf5.fecha)    mf4.fecha.textContent    = `[${b.code}]`;

                    syncF5toResults(activeMatrixIdx);
                    checkMLFeedback(activeMatrixIdx);
                });

                blocksPaletteItems.appendChild(pill);
            });
        })
        .catch(err => {
            console.error(err);
            blocksPaletteTitle.textContent = '❌ Error al leer área';
            blocksPaletteItems.innerHTML = '<span style="color:#f87171;font-size:0.72rem;">Error de conexión con el servidor OCR.</span>';
        });
    }

    // ── Utilidades ───────────────────────────────────────────────────────────
    function formatSpanish(val) {
        if (val === null || val === undefined) return '0,00';
        return String(val).trim().replace('.', ',');
    }

    // ── Modal de exportación con Pestañas (ENTRADAS / SALIDAS / TODOS) ──────
    const tabEntradas   = document.getElementById('tabEntradas');
    const tabSalidas    = document.getElementById('tabSalidas');
    const tabTodos      = document.getElementById('tabTodos');
    const tabItemCount  = document.getElementById('tabItemCount');
    let currentExportTab = 'ENTRADAS'; // 'ENTRADAS' | 'SALIDAS' | 'TODOS'

    function updateExportModalContent() {
        const selectedItems = currentResults.filter(item => item.selected !== false);
        let filtered = [];
        let lines = [];

        if (currentExportTab === 'ENTRADAS') {
            filtered = selectedItems.filter(item => item.tipo === 'ENTRADA');
            lines = filtered.map(item => {
                const fecha    = item.fecha    || '';
                const concepto = item.concepto || '';
                const codigo   = item.codigo   || '';
                const factura  = item.factura  || '';
                const val      = formatSpanish(item.importe);
                return `${fecha}\t${concepto}\t${codigo}\t${factura}\t${val}\t`;
            });
        } else if (currentExportTab === 'SALIDAS') {
            filtered = selectedItems.filter(item => item.tipo === 'SALIDA');
            lines = filtered.map(item => {
                const fecha    = item.fecha    || '';
                const concepto = item.concepto || '';
                const codigo   = item.codigo   || '';
                const factura  = item.factura  || '';
                const val      = formatSpanish(item.importe);
                return `${fecha}\t${concepto}\t${codigo}\t${factura}\t\t${val}`;
            });
        } else { // TODOS
            filtered = selectedItems;
            lines = filtered.map(item => {
                const fecha    = item.fecha    || '';
                const concepto = item.concepto || '';
                const codigo   = item.codigo   || '';
                const factura  = item.factura  || '';
                const val      = formatSpanish(item.importe);
                const entrada  = item.tipo === 'ENTRADA' ? val : '';
                const salida   = item.tipo === 'SALIDA'  ? val : '';
                return `${fecha}\t${concepto}\t${codigo}\t${factura}\t${entrada}\t${salida}`;
            });
        }

        modalTextarea.value = lines.join('\n');
        if (tabItemCount) tabItemCount.textContent = `${filtered.length} registro(s) en pestaña ${currentExportTab}`;
    }

    function setExportTab(tabName) {
        currentExportTab = tabName;
        [tabEntradas, tabSalidas, tabTodos].forEach(btn => {
            if (btn) {
                btn.style.background = '#1e293b';
                btn.style.borderColor = '#475569';
            }
        });

        if (tabName === 'ENTRADAS' && tabEntradas) {
            tabEntradas.style.background = '#064e3b';
            tabEntradas.style.borderColor = '#10b981';
        } else if (tabName === 'SALIDAS' && tabSalidas) {
            tabSalidas.style.background = '#7f1d1d';
            tabSalidas.style.borderColor = '#ef4444';
        } else if (tabName === 'TODOS' && tabTodos) {
            tabTodos.style.background = '#1e3a8a';
            tabTodos.style.borderColor = '#3b82f6';
        }

        updateExportModalContent();
    }

    if (tabEntradas) tabEntradas.addEventListener('click', () => setExportTab('ENTRADAS'));
    if (tabSalidas)  tabSalidas.addEventListener('click',  () => setExportTab('SALIDAS'));
    if (tabTodos)    tabTodos.addEventListener('click',    () => setExportTab('TODOS'));

    btnExportModal.addEventListener('click', () => {
        const selectedItems = currentResults.filter(item => item.selected !== false);
        if (selectedItems.length === 0) {
            showToast('No hay ningún documento seleccionado. Marque los checkboxes para incluirlos en la exportación.', 'warn');
            return;
        }
        setExportTab('ENTRADAS'); // Abrir por defecto en ENTRADAS
        exportModal.classList.add('active');
    });

    btnCloseModal.addEventListener('click', () => { exportModal.classList.remove('active'); });

    btnCopyClipboard.addEventListener('click', () => {
        modalTextarea.select();
        document.execCommand('copy');
        showToast(`✅ Datos de ${currentExportTab} copiados. Ve a Excel y pega con Ctrl+V.`, 'info', 4000);
    });

    // ── NAVEGACIÓN ENTRE DOCUMENTOS (▲ ▼) ─────────────────────────────────────
    function navigateDoc(dir) {
        if (currentResults.length === 0) return;
        let next;
        if (activeMatrixIdx < 0) {
            next = dir > 0 ? 0 : currentResults.length - 1;
        } else {
            next = activeMatrixIdx + dir;
            if (next < 0) next = currentResults.length - 1;  // wrap to last
            if (next >= currentResults.length) next = 0;      // wrap to first
        }
        showImage(next);
        renderMatrix(next);
    }

    if (btnNavUp)   btnNavUp.addEventListener('click',   () => navigateDoc(-1));
    if (btnNavDown) btnNavDown.addEventListener('click', () => navigateDoc(+1));

    // Atajos de teclado: Alt+Arriba / Alt+Abajo (no interfiere con el typing normal)
    document.addEventListener('keydown', e => {
        if (e.altKey && e.key === 'ArrowUp')   { e.preventDefault(); navigateDoc(-1); }
        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); navigateDoc(+1); }
    });
});


