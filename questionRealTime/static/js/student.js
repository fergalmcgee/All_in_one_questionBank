(function () {
    const statusMessage = document.getElementById('status-message');
    const initialStatusMessage = statusMessage ? statusMessage.textContent : '';
    const joinSection = document.getElementById('join-section');
    const joinForm = document.getElementById('join-form');
    const nameInput = document.getElementById('student-name');
    const questionSection = document.getElementById('question-section');
    const studentNameBanner = document.getElementById('student-name-banner');
    const sessionCodeInput = document.getElementById('session-code');
    const questionText = document.getElementById('question-text');
    const questionImages = document.getElementById('question-images');
    const topicEl = document.getElementById('topic');
    const progressEl = document.getElementById('progress');
    const answerForm = document.getElementById('answer-form');
    const answerInput = document.getElementById('answer-input');
    const answerFeedback = document.getElementById('answer-feedback');
    const officialAnswer = document.getElementById('official-answer');
    const officialAnswerText = document.getElementById('answer-text');
    const officialAnswerImages = document.getElementById('answer-images');
    const openDrawingButton = document.getElementById('open-drawing');
    const drawingPreview = document.getElementById('drawing-preview');
    const drawingPreviewImage = document.getElementById('drawing-preview-image');
    const drawingRemoveButton = document.getElementById('drawing-remove');
    const drawingOverlay = document.getElementById('drawing-overlay');
    const drawingBackground = document.getElementById('drawing-background');
    const drawingBackgroundHtml = document.getElementById('drawing-background-html');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const drawingCtx = drawingCanvas ? drawingCanvas.getContext('2d') : null;
    const drawingStage = document.querySelector('.drawing-stage');
    const drawingContent = document.querySelector('.drawing-content');
    const drawingCloseButton = document.getElementById('drawing-close');
    const drawingUndoButton = document.getElementById('drawing-undo');
    const drawingClearButton = document.getElementById('drawing-clear');
    const drawingSaveButton = document.getElementById('drawing-save');
    const drawingModeToggle = document.getElementById('drawing-mode-toggle');
    const drawingModeFab = document.getElementById('drawing-mode-toggle-floating');
    const drawingColorInput = document.getElementById('drawing-color');
    const drawingSizeInput = document.getElementById('drawing-size');
    const drawingEngineToggle = document.getElementById('drawing-engine-toggle');
    const fabricOverlay = document.getElementById('fabric-overlay');
    const fabricCanvasElement = document.getElementById('fabric-canvas');
    const fabricModeToggle = document.getElementById('fabric-mode-toggle');
    const fabricZoomInButton = document.getElementById('fabric-zoom-in');
    const fabricZoomOutButton = document.getElementById('fabric-zoom-out');
    const fabricUndoButton = document.getElementById('fabric-undo');
    const fabricClearButton = document.getElementById('fabric-clear');
    const fabricCloseButton = document.getElementById('fabric-close');
    const fabricSaveButton = document.getElementById('fabric-save');
    const fabricColorInput = document.getElementById('fabric-color');
    const fabricSizeInput = document.getElementById('fabric-size');

    const POLL_INTERVAL = 4000;
    const NAME_STORAGE_KEY = 'qrt_student_name';
    const SESSION_CODE_STORAGE_KEY = 'qrt_student_code';
    const DRAWING_ENGINE_STORAGE_KEY = 'qrt_drawing_engine';

    let pollTimer = null;
    let joined = false;
    let currentQuestionId = null;
    let respondedThisQuestion = false;
    let activeSessionCode = null;
    let currentQuestionImages = [];
    let drawingData = null;
    let currentQuestionText = '';

    const DEFAULT_MIN_VIEW_SCALE = 0.2;
    const DEFAULT_MAX_VIEW_SCALE = 3.5;

    const drawingContext = {
        strokes: [],
        pointerId: null,
        currentStroke: null,
        backgroundImage: null,
        backgroundUrl: null,
        baseWidth: 640,
        baseHeight: 480,
        mode: 'draw',
        viewTransform: {
            scale: 1,
            translateX: 0,
            translateY: 0,
            minScale: DEFAULT_MIN_VIEW_SCALE,
            maxScale: DEFAULT_MAX_VIEW_SCALE,
        },
    };
    let drawingColor = drawingColorInput ? drawingColorInput.value : '#1f2937';
    let drawingSize = drawingSizeInput ? parseInt(drawingSizeInput.value, 10) || 6 : 6;
    let detachViewportSync = null;
    let customFabPosition = null;
    let fabDragState = null;
    let skipNextFabClick = false;

    const viewInteraction = {
        pointers: new Map(),
        initialDistance: 0,
        initialScale: 1,
        isPinching: false,
    };

    const fabricState = {
        mode: 'draw',
        backgroundUrl: null,
        snapshot: null,
        lastPanPosition: null,
        minZoom: DEFAULT_MIN_VIEW_SCALE,
        maxZoom: DEFAULT_MAX_VIEW_SCALE,
    };

    let fabricCanvas = null;
    let fabricLibraryPromise = null;
    let fabricIsDragging = false;
    const FABRIC_LIBRARY_SOURCES = [
        'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
        '/static/vendor/fabric.5.3.0.min.js'
    ];

    function sanitizeStudentName(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.replace(/[^A-Za-z '\-]/g, '');
    }

    function normalizeStudentName(value) {
        const sanitized = sanitizeStudentName(value);
        return sanitized.replace(/\s+/g, ' ').trim();
    }

    function isValidStudentName(value) {
        if (!value) {
            return false;
        }
        return /^[A-Za-z][A-Za-z '\-]{0,39}$/.test(value);
    }

    const savedNameRaw = localStorage.getItem(NAME_STORAGE_KEY);
    if (savedNameRaw) {
        const normalizedSavedName = normalizeStudentName(savedNameRaw);
        if (normalizedSavedName) {
            if (normalizedSavedName !== savedNameRaw) {
                localStorage.setItem(NAME_STORAGE_KEY, normalizedSavedName);
            }
            nameInput.value = normalizedSavedName;
        } else {
            localStorage.removeItem(NAME_STORAGE_KEY);
        }
    }

    if (nameInput) {
        nameInput.addEventListener('input', (event) => {
            const sanitized = sanitizeStudentName(event.target.value);
            if (sanitized !== event.target.value) {
                event.target.value = sanitized;
                if (typeof event.target.setSelectionRange === 'function') {
                    const pos = sanitized.length;
                    event.target.setSelectionRange(pos, pos);
                }
            }
            if (!joined && statusMessage) {
                const normalized = normalizeStudentName(event.target.value);
                if (normalized && isValidStudentName(normalized) && initialStatusMessage) {
                    statusMessage.textContent = initialStatusMessage;
                }
            }
        });
    }

    const params = new URLSearchParams(window.location.search);
    const drawingEngineParam = params.get('drawing');
    let useFabricDrawing = false;
    if (drawingEngineParam === 'fabric') {
        useFabricDrawing = true;
        localStorage.setItem(DRAWING_ENGINE_STORAGE_KEY, 'fabric');
    } else if (drawingEngineParam === 'classic') {
        useFabricDrawing = false;
        localStorage.setItem(DRAWING_ENGINE_STORAGE_KEY, 'classic');
    } else {
        useFabricDrawing = localStorage.getItem(DRAWING_ENGINE_STORAGE_KEY) === 'fabric';
    }

    const codeFromUrl = params.get('code');
    if (codeFromUrl) {
        sessionCodeInput.value = codeFromUrl;
        sessionCodeInput.readOnly = true;
        sessionCodeInput.setAttribute('aria-readonly', 'true');
    } else {
        const storedCode = localStorage.getItem(SESSION_CODE_STORAGE_KEY);
        if (storedCode) {
            sessionCodeInput.value = storedCode;
        }
    }

    joinForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const code = sessionCodeInput.value.trim();
        const normalizedName = normalizeStudentName(nameInput.value);
        if (!code) {
            sessionCodeInput.focus();
            return;
        }
        if (!isValidStudentName(normalizedName)) {
            statusMessage.textContent = 'Use letters A-Z only for your name (spaces, hyphens, and apostrophes are ok).';
            nameInput.focus();
            return;
        }
        nameInput.value = normalizedName;
        joined = true;
        activeSessionCode = code;
        localStorage.setItem(NAME_STORAGE_KEY, normalizedName);
        if (!sessionCodeInput.readOnly) {
            localStorage.setItem(SESSION_CODE_STORAGE_KEY, code);
        }
        setStudentNameBanner(normalizedName);
        joinSection.classList.add('hidden');
        questionSection.classList.remove('hidden');
        statusMessage.textContent = 'You are in! Waiting for the next question.';
        fetchState();
        startPolling();
        updateDrawingAvailability();
    });

    if (answerInput) {
        answerInput.addEventListener('keydown', handleAnswerInputKeydown);
    }

    function updateDrawingEngineToggleLabel() {
        if (!drawingEngineToggle) {
            return;
        }
        drawingEngineToggle.textContent = useFabricDrawing
            ? 'Switch to classic drawing'
            : 'Try the new drawing beta';
        drawingEngineToggle.setAttribute('aria-label', useFabricDrawing
            ? 'Switch back to the classic drawing tool'
            : 'Try the new drawing tool beta');
    }

    function setDrawingEngine(engine) {
        const next = engine === 'fabric';
        if (useFabricDrawing === next) {
            return;
        }
        useFabricDrawing = next;
        localStorage.setItem(DRAWING_ENGINE_STORAGE_KEY, useFabricDrawing ? 'fabric' : 'classic');
        updateDrawingEngineToggleLabel();
        if (drawingOverlay) {
            drawingOverlay.classList.add('hidden');
            drawingOverlay.removeAttribute('tabindex');
        }
        if (fabricOverlay) {
            fabricOverlay.classList.add('hidden');
            fabricOverlay.removeAttribute('tabindex');
        }
        document.body.style.overflow = '';
        fabricIsDragging = false;
        fabricState.lastPanPosition = null;
        setDrawingMode('draw');
        setFabricMode('draw');
        updateDrawingAvailability();
    }

    if (drawingEngineToggle) {
        drawingEngineToggle.classList.remove('hidden');
        updateDrawingEngineToggleLabel();
        drawingEngineToggle.addEventListener('click', () => {
            setDrawingEngine(useFabricDrawing ? 'classic' : 'fabric');
        });
    }

    if (openDrawingButton) {
        openDrawingButton.addEventListener('click', () => {
            if (openDrawingButton.disabled) {
                return;
            }
            openDrawingOverlay();
        });
    }

    if (drawingRemoveButton) {
        drawingRemoveButton.addEventListener('click', () => {
            drawingData = null;
            updateDrawingPreview();
            answerFeedback.textContent = '';
            drawingContext.strokes = [];
            if (drawingCanvas && drawingCtx) {
                redrawDrawingCanvas();
            }
            if (fabricCanvas) {
                fabricCanvas.getObjects().slice().forEach((obj) => fabricCanvas.remove(obj));
                fabricCanvas.requestRenderAll();
            }
            fabricState.snapshot = null;
            updateFabricControls();
            updateDrawingAvailability();
        });
    }

    if (drawingBackground) {
        drawingBackground.addEventListener('dragstart', (event) => event.preventDefault());
        drawingBackground.addEventListener('mousedown', (event) => {
            if (drawingContext.mode === 'draw') {
                event.preventDefault();
            }
        });
        drawingBackground.addEventListener('touchstart', (event) => {
            if (drawingContext.mode === 'draw') {
                event.preventDefault();
            }
        }, { passive: false });
    }

    if (drawingCloseButton) {
        drawingCloseButton.addEventListener('click', closeDrawingOverlay);
    }

    if (drawingOverlay) {
        drawingOverlay.addEventListener('click', (event) => {
            if (event.target === drawingOverlay) {
                closeDrawingOverlay();
            }
        });
        drawingOverlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeDrawingOverlay();
            }
        });
    }

    if (drawingModeToggle) {
        drawingModeToggle.addEventListener('click', toggleDrawingMode);
    }
    if (drawingModeFab) {
        drawingModeFab.addEventListener('click', onFloatingToggleClick);
        drawingModeFab.addEventListener('pointerdown', onFabPointerDown);
        drawingModeFab.addEventListener('pointermove', onFabPointerMove);
        drawingModeFab.addEventListener('pointerup', onFabPointerUp);
        drawingModeFab.addEventListener('pointercancel', onFabPointerUp);
    }

    if (fabricModeToggle) {
        fabricModeToggle.addEventListener('click', toggleFabricMode);
    }
    if (fabricZoomInButton) {
        fabricZoomInButton.addEventListener('click', () => adjustFabricZoom(1));
    }
    if (fabricZoomOutButton) {
        fabricZoomOutButton.addEventListener('click', () => adjustFabricZoom(-1));
    }
    if (fabricUndoButton) {
        fabricUndoButton.addEventListener('click', fabricUndo);
    }
    if (fabricClearButton) {
        fabricClearButton.addEventListener('click', fabricClear);
    }
    if (fabricCloseButton) {
        fabricCloseButton.addEventListener('click', closeFabricOverlay);
    }
    if (fabricSaveButton) {
        fabricSaveButton.addEventListener('click', saveFabricDrawing);
    }
    if (fabricColorInput) {
        fabricColorInput.addEventListener('input', (event) => {
            if (fabricCanvas && fabricCanvas.freeDrawingBrush) {
                fabricCanvas.freeDrawingBrush.color = event.target.value || '#1f2937';
            }
        });
    }
    if (fabricSizeInput) {
        fabricSizeInput.addEventListener('input', (event) => {
            if (fabricCanvas && fabricCanvas.freeDrawingBrush) {
                const value = parseInt(event.target.value, 10);
                fabricCanvas.freeDrawingBrush.width = Number.isFinite(value) ? value : 6;
            }
        });
    }

    if (drawingStage) {
        drawingStage.addEventListener('touchstart', handleStageTouch, { passive: false });
        drawingStage.addEventListener('touchmove', handleStageTouch, { passive: false });
        drawingStage.addEventListener('contextmenu', (event) => event.preventDefault());
        drawingStage.addEventListener('pointerdown', onStagePointerDown);
        drawingStage.addEventListener('pointermove', onStagePointerMove);
        drawingStage.addEventListener('pointerup', onStagePointerUp);
        drawingStage.addEventListener('pointercancel', onStagePointerUp);
    }

    if (drawingUndoButton) {
        drawingUndoButton.addEventListener('click', () => {
            if (drawingContext.pointerId !== null) {
                return;
            }
            if (drawingContext.strokes.length > 0) {
                drawingContext.strokes.pop();
                redrawDrawingCanvas();
                updateDrawingControls();
            }
        });
    }

    if (drawingClearButton) {
        drawingClearButton.addEventListener('click', () => {
            if (drawingContext.pointerId !== null) {
                return;
            }
            drawingContext.strokes = [];
            redrawDrawingCanvas();
            updateDrawingControls();
        });
    }

    if (drawingSaveButton) {
        drawingSaveButton.addEventListener('click', saveDrawing);
    }

    if (drawingColorInput) {
        drawingColorInput.addEventListener('input', (event) => {
            drawingColor = event.target.value || '#1f2937';
        });
    }

    if (drawingSizeInput) {
        drawingSizeInput.addEventListener('input', (event) => {
            const value = parseInt(event.target.value, 10);
            drawingSize = Number.isFinite(value) ? Math.min(Math.max(value, 2), 24) : 6;
        });
    }

    if (drawingCanvas) {
        drawingCanvas.addEventListener('pointerdown', onCanvasPointerDown);
        drawingCanvas.addEventListener('pointermove', onCanvasPointerMove);
        drawingCanvas.addEventListener('pointerup', onCanvasPointerUp);
        drawingCanvas.addEventListener('pointercancel', onCanvasPointerUp);
        drawingCanvas.addEventListener('pointerleave', onCanvasPointerUp);
    }

    if (fabricOverlay) {
        fabricOverlay.addEventListener('pointerdown', (event) => {
            if (event.target === fabricOverlay && event.pointerType === 'mouse') {
                closeFabricOverlay();
            }
        });
        fabricOverlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeFabricOverlay();
            }
        });
    }

    updateDrawingPreview();
    updateDrawingAvailability();
    updateDrawingControls();
    applyViewTransform();

    answerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!joined || respondedThisQuestion || !activeSessionCode) {
            return;
        }
        const normalizedName = normalizeStudentName(nameInput.value);
        if (!isValidStudentName(normalizedName)) {
            answerFeedback.textContent = 'Update your name to use letters A-Z only (spaces, hyphens, and apostrophes are ok).';
            nameInput.focus();
            return;
        }
        nameInput.value = normalizedName;
        localStorage.setItem(NAME_STORAGE_KEY, normalizedName);
        setStudentNameBanner(normalizedName);
        const answer = answerInput.value.trim();
        if (!answer && !drawingData) {
            answerFeedback.textContent = 'Add some text or include a drawing before sending.';
            answerInput.focus();
            return;
        }

        setFormDisabled(true);
        try {
            const payload = { name: normalizedName, answer, code: activeSessionCode };
            if (drawingData) {
                payload.drawing_url = drawingData.url;
            }
            const response = await fetch('/api/session/responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error('Failed to send answer');
            }
            respondedThisQuestion = true;
            answerFeedback.textContent = 'Answer received!';
            updateDrawingAvailability();
            updateDrawingControls();
        } catch (error) {
            console.error(error);
            answerFeedback.textContent = 'Could not send answer. Try again.';
            setFormDisabled(false);
        }
    });

    function setFormDisabled(state) {
        answerInput.disabled = state;
        answerForm.querySelector('button').disabled = state;
        if (drawingRemoveButton) {
            drawingRemoveButton.disabled = state || respondedThisQuestion || !drawingData;
        }
        updateDrawingAvailability();
        updateDrawingControls();
    }

    function handleAnswerInputKeydown(event) {
        if (event.key !== 'Tab') {
            return;
        }
        const target = event.target;
        if (!(target && typeof target.selectionStart === 'number')) {
            return;
        }
        event.preventDefault();

        const indent = '\t';
        const value = target.value;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const hasSelection = start !== end;
        const selectionText = value.slice(start, end);
        const isMultiLineSelection = hasSelection && selectionText.includes('\n');

        if (event.shiftKey) {
            if (isMultiLineSelection) {
                const blockStart = value.lastIndexOf('\n', start - 1) + 1;
                let blockEnd = value.indexOf('\n', end);
                if (blockEnd === -1) {
                    blockEnd = value.length;
                }
                const block = value.slice(blockStart, blockEnd).split('\n');
                const updated = block.map((line) => {
                    if (line.startsWith(indent)) {
                        return line.slice(indent.length);
                    }
                    if (line.startsWith('    ')) {
                        return line.slice(4);
                    }
                    if (line.startsWith('\t')) {
                        return line.slice(1);
                    }
                    return line;
                });
                const updatedBlock = updated.join('\n');
                target.value = value.slice(0, blockStart) + updatedBlock + value.slice(blockEnd);
                target.selectionStart = blockStart;
                target.selectionEnd = blockStart + updatedBlock.length;
                return;
            }

            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const firstChars = value.slice(lineStart, lineStart + indent.length);
            let removal = 0;
            if (firstChars === indent) {
                removal = indent.length;
            } else if (value.startsWith('    ', lineStart)) {
                removal = 4;
            } else if (value.startsWith('\t', lineStart)) {
                removal = 1;
            }
            if (removal > 0) {
                const before = value.slice(0, lineStart);
                const after = value.slice(lineStart + removal);
                target.value = before + after;
                const newPos = Math.max(lineStart, start - removal);
                target.selectionStart = newPos;
                target.selectionEnd = hasSelection ? Math.max(newPos, end - removal) : newPos;
            }
            return;
        }

        if (isMultiLineSelection) {
            const blockStart = value.lastIndexOf('\n', start - 1) + 1;
            let blockEnd = value.indexOf('\n', end);
            if (blockEnd === -1) {
                blockEnd = value.length;
            }
            const block = value.slice(blockStart, blockEnd).split('\n');
            const updated = block.map((line) => indent + line);
            const updatedBlock = updated.join('\n');
            target.value = value.slice(0, blockStart) + updatedBlock + value.slice(blockEnd);
            target.selectionStart = blockStart;
            target.selectionEnd = blockStart + updatedBlock.length;
            return;
        }

        const before = value.slice(0, start);
        const after = value.slice(end);
        target.value = before + indent + after;
        const newPos = start + indent.length;
        target.selectionStart = newPos;
        target.selectionEnd = newPos;
    }

    function setStudentNameBanner(name) {
        if (!studentNameBanner) {
            return;
        }
        const displayName = normalizeStudentName(name);
        if (displayName) {
            studentNameBanner.textContent = displayName;
            studentNameBanner.classList.remove('hidden');
        } else {
            studentNameBanner.textContent = '';
            studentNameBanner.classList.add('hidden');
        }
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        pollTimer = setInterval(fetchState, POLL_INTERVAL);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function fetchState() {
        if (!activeSessionCode) {
            return;
        }
        try {
            const response = await fetch(`/api/session?view=student&code=${encodeURIComponent(activeSessionCode)}`);
            if (!response.ok) {
                throw new Error('Session not found');
            }
            const data = await response.json();
            renderState(data);
        } catch (error) {
            console.error('Unable to fetch state', error);
            handleMissingSession();
        }
    }

    function renderState(state) {
        if (!state || !state.active) {
            statusMessage.textContent = 'Waiting for the teacher to start a session…';
            showQuestionMessage('Waiting for the teacher to start…');
            questionImages.innerHTML = '';
            progressEl.textContent = '';
            topicEl.textContent = '';
            officialAnswer.classList.add('hidden');
            answerForm.classList.add('hidden');
            setFormDisabled(false);
            respondedThisQuestion = false;
            resetDrawingState();
            return;
        }

        if (state.session_code && !activeSessionCode) {
            activeSessionCode = state.session_code;
        }

        const question = state.question;
        if (!question) {
            showQuestionMessage('Teacher is preparing the next question…');
            questionImages.innerHTML = '';
            answerForm.classList.add('hidden');
            officialAnswer.classList.add('hidden');
            currentQuestionImages = [];
            updateDrawingAvailability();
            return;
        }

        currentQuestionImages = Array.isArray(question.images) ? question.images : [];
        currentQuestionText = question.text || '';
        updateDrawingAvailability();

        hideQuestionText();
        progressEl.textContent = state.total_questions
            ? `Question ${state.current_index + 1} / ${state.total_questions}`
            : '';
        topicEl.textContent = question.topic ? `Topic: ${question.topic}` : '';
        renderImages(questionImages, question.images || []);

        if (question.id !== currentQuestionId) {
            currentQuestionId = question.id;
            respondedThisQuestion = false;
            answerInput.value = '';
            answerFeedback.textContent = '';
            setFormDisabled(false);
            hideQuestionText();
            resetDrawingState();
            closeDrawingOverlay();
        }

        if (joined) {
            answerForm.classList.remove('hidden');
            if (respondedThisQuestion) {
                setFormDisabled(true);
            }
        }

        if (state.revealed && question.answer && (question.answer.text || (question.answer.images && question.answer.images.length))) {
            officialAnswer.classList.remove('hidden');
            officialAnswerText.textContent = question.answer.text || '';
            renderImages(officialAnswerImages, question.answer.images || []);
        } else {
            officialAnswer.classList.add('hidden');
            officialAnswerText.textContent = '';
            officialAnswerImages.innerHTML = '';
        }
    }

    function renderImages(container, urls) {
        container.innerHTML = '';
        urls.forEach((url) => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Question asset';
            container.appendChild(img);
        });
    }

    function updateDrawingAvailability() {
        if (!openDrawingButton) {
            return;
        }
        const hasImages = currentQuestionImages.length > 0;
        openDrawingButton.classList.toggle('hidden', !hasImages);
        const shouldDisable = !hasImages || respondedThisQuestion || !joined || answerInput.disabled;
        openDrawingButton.disabled = shouldDisable;
        if (drawingEngineToggle) {
            drawingEngineToggle.classList.toggle('hidden', !hasImages);
            drawingEngineToggle.disabled = shouldDisable;
            updateDrawingEngineToggleLabel();
        }
        updateDrawingControls();
    }

    function updateDrawingPreview() {
        if (!drawingPreview || !drawingPreviewImage || !drawingRemoveButton) {
            return;
        }
        if (drawingData && drawingData.url) {
            drawingPreviewImage.src = drawingData.url;
            drawingPreview.classList.remove('hidden');
            drawingRemoveButton.disabled = respondedThisQuestion;
        } else {
            drawingPreview.classList.add('hidden');
            drawingPreviewImage.removeAttribute('src');
        }
        updateDrawingControls();
    }

    function resetDrawingState() {
        drawingData = null;
        drawingContext.strokes = [];
        drawingContext.pointerId = null;
        drawingContext.currentStroke = null;
        drawingContext.backgroundImage = null;
        drawingContext.backgroundUrl = null;
        updateDrawingPreview();
        if (drawingOverlay) {
            drawingOverlay.classList.add('hidden');
        }
        document.body.style.overflow = '';
        setDrawingMode('draw');
        updateDrawingAvailability();
        if (drawingBackground) {
            drawingBackground.removeAttribute('src');
            drawingBackground.style.display = 'none';
        }
        if (drawingStage) {
            drawingStage.style.width = '';
            drawingStage.style.height = '';
        }
        if (drawingCanvas) {
            drawingCanvas.width = 0;
            drawingCanvas.height = 0;
            drawingCanvas.style.width = '0px';
            drawingCanvas.style.height = '0px';
        }
        updateDrawingControls();
        resetViewTransform();
        syncFloatingToggleWithViewport(false);
        if (fabricCanvas) {
            fabricCanvas.clear();
            fabricCanvas.setBackgroundImage(null, fabricCanvas.renderAll.bind(fabricCanvas));
        }
        fabricState.snapshot = null;
        fabricState.backgroundUrl = null;
    }

    function openDrawingOverlay() {
        if (useFabricDrawing) {
            openFabricOverlay();
            return;
        }
        if (!drawingOverlay || !drawingCanvas || !drawingCtx || !currentQuestionImages.length) {
            return;
        }
        document.body.style.overflow = 'hidden';
        drawingOverlay.classList.remove('hidden');
        drawingOverlay.setAttribute('tabindex', '-1');
        drawingOverlay.focus();
        setDrawingMode('draw');
        prepareDrawingCanvas();
        syncFloatingToggleWithViewport(true);
    }

    function closeDrawingOverlay() {
        if (useFabricDrawing) {
            closeFabricOverlay();
            return;
        }
        if (!drawingOverlay) {
            return;
        }
        drawingOverlay.classList.add('hidden');
        drawingOverlay.removeAttribute('tabindex');
        document.body.style.overflow = '';
        drawingContext.pointerId = null;
        drawingContext.currentStroke = null;
        updateDrawingControls();
        syncFloatingToggleWithViewport(false);
        viewInteraction.pointers.clear();
        viewInteraction.initialDistance = 0;
        viewInteraction.initialScale = drawingContext.viewTransform.scale;
        viewInteraction.isPinching = false;
    }

    function toggleDrawingMode() {
        const nextMode = drawingContext.mode === 'draw' ? 'view' : 'draw';
        setDrawingMode(nextMode);
    }

    function setDrawingMode(mode) {
        drawingContext.mode = mode;
        if (drawingCanvas) {
            if (mode === 'draw') {
                drawingCanvas.classList.remove('view-mode');
                drawingCanvas.style.touchAction = 'none';
                drawingCanvas.style.cursor = 'crosshair';
                drawingCanvas.style.pointerEvents = 'auto';
            } else {
                drawingCanvas.classList.add('view-mode');
                drawingCanvas.style.touchAction = 'auto';
                drawingCanvas.style.cursor = 'grab';
                drawingCanvas.style.pointerEvents = 'none';
            }
        }
        if (drawingStage) {
            drawingStage.style.touchAction = mode === 'draw' ? 'none' : 'auto';
            if (mode === 'draw') {
                viewInteraction.pointers.clear();
                viewInteraction.isPinching = false;
                viewInteraction.initialDistance = 0;
                viewInteraction.initialScale = drawingContext.viewTransform.scale;
            }
        }
        if (drawingModeToggle) {
            drawingModeToggle.classList.toggle('active', mode === 'draw');
            drawingModeToggle.textContent = mode === 'draw' ? '🖊' : '🖐';
            drawingModeToggle.title = mode === 'draw' ? 'Drawing mode (tap to switch to pan/zoom)' : 'Pan/zoom mode (tap to draw)';
            drawingModeToggle.setAttribute('aria-pressed', mode === 'draw');
        }
        if (drawingModeFab) {
            drawingModeFab.classList.toggle('view-mode', mode !== 'draw');
            drawingModeFab.textContent = mode === 'draw' ? '🖊' : '🖐';
            drawingModeFab.title = mode === 'draw' ? 'Drawing mode (tap to switch to pan/zoom)' : 'Pan/zoom mode (tap to draw)';
            drawingModeFab.setAttribute('aria-pressed', mode === 'draw');
            drawingModeFab.classList.remove('hidden');
        }
        updateFloatingTogglePosition();
        updateViewScaleBounds();
        applyViewTransform();
        updateDrawingControls();
    }

    function onFloatingToggleClick(event) {
        if (skipNextFabClick) {
            skipNextFabClick = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        toggleDrawingMode();
    }

    function onFabPointerDown(event) {
        if (!drawingModeFab || drawingModeFab.disabled || drawingContext.mode !== 'view') {
            fabDragState = null;
            return;
        }
        const rect = drawingModeFab.getBoundingClientRect();
        fabDragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            dragging: false,
        };
    }

    function onFabPointerMove(event) {
        if (!fabDragState || event.pointerId !== fabDragState.pointerId) {
            return;
        }
        if (!drawingModeFab || drawingModeFab.disabled || drawingContext.mode !== 'view') {
            return;
        }
        const dx = event.clientX - fabDragState.startX;
        const dy = event.clientY - fabDragState.startY;
        if (!fabDragState.dragging) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
                return;
            }
            fabDragState.dragging = true;
            skipNextFabClick = true;
            drawingModeFab.setPointerCapture(event.pointerId);
        }
        event.preventDefault();

        const viewport = getViewportMetrics();
        const margin = viewport.width < 520 ? 16 : 20;
        const width = drawingModeFab.offsetWidth || 48;
        const height = drawingModeFab.offsetHeight || 48;

        let minLeft = viewport.offsetLeft + margin;
        let maxLeft = viewport.offsetLeft + viewport.width - width - margin;
        if (maxLeft < minLeft) {
            const center = viewport.offsetLeft + (viewport.width - width) / 2;
            minLeft = center;
            maxLeft = center;
        }
        let minTop = viewport.offsetTop + margin;
        let maxTop = viewport.offsetTop + viewport.height - height - margin;
        if (maxTop < minTop) {
            const middle = viewport.offsetTop + (viewport.height - height) / 2;
            minTop = middle;
            maxTop = middle;
        }

        let left = event.clientX - fabDragState.offsetX;
        let top = event.clientY - fabDragState.offsetY;
        left = clamp(left, minLeft, maxLeft);
        top = clamp(top, minTop, maxTop);

        drawingModeFab.style.right = 'auto';
        drawingModeFab.style.bottom = 'auto';
        drawingModeFab.style.left = `${left}px`;
        drawingModeFab.style.top = `${top}px`;

        const horizontalSpan = Math.max(maxLeft - minLeft, 1);
        const verticalSpan = Math.max(maxTop - minTop, 1);
        customFabPosition = {
            leftRatio: horizontalSpan > 0 ? clamp((left - minLeft) / horizontalSpan, 0, 1) : 0,
            topRatio: verticalSpan > 0 ? clamp((top - minTop) / verticalSpan, 0, 1) : 0,
        };
    }

    function onFabPointerUp(event) {
        if (!fabDragState || event.pointerId !== fabDragState.pointerId) {
            return;
        }
        if (fabDragState.dragging && drawingModeFab && drawingModeFab.hasPointerCapture(event.pointerId)) {
            drawingModeFab.releasePointerCapture(event.pointerId);
        }
        if (fabDragState.dragging) {
            updateFloatingTogglePosition();
            setTimeout(() => {
                skipNextFabClick = false;
            }, 0);
        }
        fabDragState = null;
    }

    function prepareDrawingCanvas() {
        if (useFabricDrawing) {
            return;
        }
        if (!drawingCanvas || !drawingCtx) {
            return;
        }
        const backgroundUrl = currentQuestionImages[0] || null;
        const shouldResetView = drawingContext.backgroundUrl !== backgroundUrl;
        if (shouldResetView) {
            drawingContext.backgroundUrl = backgroundUrl;
            drawingContext.backgroundImage = null;
            drawingContext.strokes = [];
        }

        if (backgroundUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                drawingContext.backgroundImage = img;
                drawingContext.baseWidth = img.naturalWidth;
                drawingContext.baseHeight = img.naturalHeight;
                configureCanvasSize(drawingContext.baseWidth, drawingContext.baseHeight);
                if (shouldResetView) {
                    resetViewTransform();
                } else {
                    applyViewTransform();
                }
                redrawDrawingCanvas();
                updateDrawingControls();
                if (drawingBackground) {
                    drawingBackground.style.display = 'block';
                }
            };
            img.onerror = () => {
                drawingContext.backgroundImage = null;
                drawingContext.baseWidth = 640;
                drawingContext.baseHeight = 480;
                configureCanvasSize(drawingContext.baseWidth, drawingContext.baseHeight);
                if (shouldResetView) {
                    resetViewTransform();
                } else {
                    applyViewTransform();
                }
                redrawDrawingCanvas();
                updateDrawingControls();
                if (drawingBackground) {
                    drawingBackground.style.display = 'block';
                }
            };
            img.src = backgroundUrl;
            if (drawingBackground) {
                drawingBackground.src = backgroundUrl;
            }
        } else {
            drawingContext.baseWidth = 640;
            drawingContext.baseHeight = 480;
            configureCanvasSize(drawingContext.baseWidth, drawingContext.baseHeight);
            if (shouldResetView) {
                resetViewTransform();
            } else {
                applyViewTransform();
            }
            redrawDrawingCanvas();
            updateDrawingControls();
            if (drawingBackground) {
                drawingBackground.removeAttribute('src');
                drawingBackground.style.display = 'none';
            }
        }
    }

    function configureCanvasSize(width, height) {
        if (!drawingCanvas || !drawingCtx) {
            return;
        }
        const MAX_CANVAS_DIMENSION = 2400;
        const widthSafe = Math.max(width, 1);
        const heightSafe = Math.max(height, 1);
        const dominant = Math.max(widthSafe, heightSafe);
        const scale = dominant > MAX_CANVAS_DIMENSION
            ? MAX_CANVAS_DIMENSION / dominant
            : 1;
        const canvasWidth = Math.max(Math.round(widthSafe * scale), 1);
        const canvasHeight = Math.max(Math.round(heightSafe * scale), 1);
        if (drawingStage) {
            drawingStage.style.width = `${canvasWidth}px`;
            drawingStage.style.height = `${canvasHeight}px`;
        }
        drawingCanvas.width = canvasWidth;
        drawingCanvas.height = canvasHeight;
        updateViewScaleBounds();
        drawingCanvas.style.width = `${canvasWidth}px`;
        drawingCanvas.style.height = `${canvasHeight}px`;
        if (drawingBackground) {
            drawingBackground.style.width = `${canvasWidth}px`;
            drawingBackground.style.height = `${canvasHeight}px`;
        }
    }

    function redrawDrawingCanvas() {
        if (!drawingCanvas || !drawingCtx) {
            return;
        }
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        drawingContext.strokes.forEach((stroke) => drawStroke(stroke));
    }

    function drawStroke(stroke) {
        if (!drawingCtx || stroke.points.length === 0) {
            return;
        }
        const scale = drawingCanvas.width / (drawingContext.baseWidth || drawingCanvas.width);
        const width = Math.max(stroke.size * scale, 1.5);
        drawingCtx.strokeStyle = stroke.color;
        drawingCtx.lineWidth = width;
        drawingCtx.lineCap = 'round';
        drawingCtx.lineJoin = 'round';
        if (stroke.points.length === 1) {
            const point = toCanvasCoords(stroke.points[0]);
            drawingCtx.beginPath();
            drawingCtx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
            drawingCtx.fillStyle = stroke.color;
            drawingCtx.fill();
            return;
        }
        drawingCtx.beginPath();
        const first = toCanvasCoords(stroke.points[0]);
        drawingCtx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length; i += 1) {
            const point = toCanvasCoords(stroke.points[i]);
            drawingCtx.lineTo(point.x, point.y);
        }
        drawingCtx.stroke();
    }

    function drawLatestSegment(stroke) {
        if (!drawingCtx || stroke.points.length < 2) {
            return;
        }
        const len = stroke.points.length;
        const prev = toCanvasCoords(stroke.points[len - 2]);
        const curr = toCanvasCoords(stroke.points[len - 1]);
        const scale = drawingCanvas.width / (drawingContext.baseWidth || drawingCanvas.width);
        const width = Math.max(stroke.size * scale, 1.5);
        drawingCtx.strokeStyle = stroke.color;
        drawingCtx.lineWidth = width;
        drawingCtx.lineCap = 'round';
        drawingCtx.lineJoin = 'round';
        drawingCtx.beginPath();
        drawingCtx.moveTo(prev.x, prev.y);
        drawingCtx.lineTo(curr.x, curr.y);
        drawingCtx.stroke();
    }

    function toCanvasCoords(point) {
        return {
            x: point.x * drawingCanvas.width,
            y: point.y * drawingCanvas.height,
        };
    }

    function getRelativePoint(event) {
        const rect = drawingCanvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        return {
            x: Math.min(Math.max(x, 0), 1),
            y: Math.min(Math.max(y, 0), 1),
        };
    }

    function onCanvasPointerDown(event) {
        if (!drawingCanvas || drawingContext.pointerId !== null || drawingContext.mode !== 'draw') {
            return;
        }
        event.preventDefault();
        drawingCanvas.setPointerCapture(event.pointerId);
        const point = getRelativePoint(event);
        const stroke = {
            color: drawingColor,
            size: drawingSize,
            points: [point],
        };
        drawingContext.pointerId = event.pointerId;
        drawingContext.currentStroke = stroke;
        drawingContext.strokes.push(stroke);
        drawStroke(stroke);
        updateDrawingControls();
        setFloatingToggleHidden(true);
    }

    function onCanvasPointerMove(event) {
        if (drawingContext.pointerId !== event.pointerId || !drawingContext.currentStroke || drawingContext.mode !== 'draw') {
            return;
        }
        event.preventDefault();
        const point = getRelativePoint(event);
        const stroke = drawingContext.currentStroke;
        const lastPoint = stroke.points[stroke.points.length - 1];
        if (!lastPoint || lastPoint.x !== point.x || lastPoint.y !== point.y) {
            stroke.points.push(point);
            drawLatestSegment(stroke);
        }
    }

    function onCanvasPointerUp(event) {
        if (drawingContext.pointerId !== event.pointerId) {
            return;
        }
        event.preventDefault();
        if (drawingCanvas) {
            drawingCanvas.releasePointerCapture(event.pointerId);
        }
        drawingContext.pointerId = null;
        drawingContext.currentStroke = null;
        updateDrawingControls();
        setFloatingToggleHidden(false);
    }

    function onStagePointerDown(event) {
        if (!drawingStage || drawingContext.mode !== 'view' || event.target === drawingModeFab) {
            return;
        }
        updateViewScaleBounds();
        drawingStage.setPointerCapture(event.pointerId);
        viewInteraction.pointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });
        if (viewInteraction.pointers.size === 1) {
            viewInteraction.initialScale = drawingContext.viewTransform.scale;
            viewInteraction.initialDistance = 0;
            viewInteraction.isPinching = false;
        }
        if (viewInteraction.pointers.size === 2) {
            const points = Array.from(viewInteraction.pointers.values());
            viewInteraction.initialDistance = distanceBetween(points[0], points[1]);
            viewInteraction.initialScale = drawingContext.viewTransform.scale;
            viewInteraction.isPinching = true;
        }
        event.preventDefault();
    }

    function onStagePointerMove(event) {
        if (drawingContext.mode !== 'view') {
            return;
        }
        const pointer = viewInteraction.pointers.get(event.pointerId);
        if (!pointer) {
            return;
        }
        const previous = { x: pointer.x, y: pointer.y };
        pointer.x = event.clientX;
        pointer.y = event.clientY;

        if (viewInteraction.pointers.size >= 2) {
            const points = Array.from(viewInteraction.pointers.values());
            const distance = distanceBetween(points[0], points[1]);
            if (!viewInteraction.isPinching) {
                viewInteraction.initialDistance = distance;
                viewInteraction.initialScale = drawingContext.viewTransform.scale;
                viewInteraction.isPinching = true;
            }
            if (viewInteraction.initialDistance > 0 && distance > 0) {
                const rawScale = viewInteraction.initialScale * (distance / viewInteraction.initialDistance);
                const transform = drawingContext.viewTransform;
                const newScale = clamp(rawScale, transform.minScale, transform.maxScale);
                const center = {
                    x: (points[0].x + points[1].x) / 2,
                    y: (points[0].y + points[1].y) / 2,
                };
                updateViewScale(center, newScale);
                viewInteraction.initialScale = drawingContext.viewTransform.scale;
                viewInteraction.initialDistance = distance;
            }
        } else {
            const dx = pointer.x - previous.x;
            const dy = pointer.y - previous.y;
            if (dx !== 0 || dy !== 0) {
                const transform = drawingContext.viewTransform;
                transform.translateX += dx;
                transform.translateY += dy;
                applyViewTransform();
            }
        }
        event.preventDefault();
    }

    function onStagePointerUp(event) {
        if (drawingStage && drawingStage.hasPointerCapture(event.pointerId)) {
            drawingStage.releasePointerCapture(event.pointerId);
        }
        if (viewInteraction.pointers.has(event.pointerId)) {
            viewInteraction.pointers.delete(event.pointerId);
        }
        if (viewInteraction.pointers.size < 2) {
            viewInteraction.isPinching = false;
            viewInteraction.initialDistance = 0;
            viewInteraction.initialScale = drawingContext.viewTransform.scale;
        }
        applyViewTransform();
        event.preventDefault();
    }

    async function uploadDrawingDataUrl(dataUrl) {
        if (!activeSessionCode) {
            throw new Error('Missing session code');
        }
        const response = await fetch('/api/student/upload-drawing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: activeSessionCode, image: dataUrl })
        });
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        return response.json();
    }

    function getFabricEventPoint(event) {
        if (!event) {
            return null;
        }
        if (event.touches && event.touches.length) {
            const touch = event.touches[0];
            return {
                x: typeof touch.clientX === 'number' ? touch.clientX : touch.pageX,
                y: typeof touch.clientY === 'number' ? touch.clientY : touch.pageY,
            };
        }
        if (event.changedTouches && event.changedTouches.length) {
            const touch = event.changedTouches[0];
            return {
                x: typeof touch.clientX === 'number' ? touch.clientX : touch.pageX,
                y: typeof touch.clientY === 'number' ? touch.clientY : touch.pageY,
            };
        }
        if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
            return { x: event.clientX, y: event.clientY };
        }
        if (typeof event.x === 'number' && typeof event.y === 'number') {
            return { x: event.x, y: event.y };
        }
        return null;
    }

    function getFabricCanvasCenterPoint() {
        if (!fabricCanvas) {
            return new fabric.Point(0, 0);
        }
        const width = fabricCanvas.getWidth() || 0;
        const height = fabricCanvas.getHeight() || 0;
        return new fabric.Point(width / 2, height / 2);
    }

    function setFabricZoom(targetZoom, originPoint) {
        if (!fabricCanvas) {
            return;
        }
        const zoom = clamp(targetZoom, fabricState.minZoom, fabricState.maxZoom);
        const point = originPoint || getFabricCanvasCenterPoint();
        fabricCanvas.zoomToPoint(point, zoom);
        clampFabricViewport();
        fabricCanvas.requestRenderAll();
        updateFabricControls();
    }

    function adjustFabricZoom(direction) {
        if (!fabricCanvas) {
            return;
        }
        const currentZoom = fabricCanvas.getZoom() || 1;
        const factor = direction > 0 ? 1.2 : 1 / 1.2;
        setFabricZoom(currentZoom * factor, getFabricCanvasCenterPoint());
    }

    function getFabricEventPoint(event) {
        if (!event) {
            return null;
        }
        if (event.touches && event.touches.length) {
            const touch = event.touches[0];
            return {
                x: typeof touch.clientX === 'number' ? touch.clientX : touch.pageX,
                y: typeof touch.clientY === 'number' ? touch.clientY : touch.pageY,
            };
        }
        if (event.changedTouches && event.changedTouches.length) {
            const touch = event.changedTouches[0];
            return {
                x: typeof touch.clientX === 'number' ? touch.clientX : touch.pageX,
                y: typeof touch.clientY === 'number' ? touch.clientY : touch.pageY,
            };
        }
        if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
            return { x: event.clientX, y: event.clientY };
        }
        if (typeof event.x === 'number' && typeof event.y === 'number') {
            return { x: event.x, y: event.y };
        }
        return null;
    }

    async function saveDrawing() {
        if (!activeSessionCode) {
            return;
        }
        if (!drawingCanvas || !drawingCtx || drawingContext.strokes.length === 0) {
            if (answerFeedback) {
                answerFeedback.textContent = 'Draw something before saving.';
            }
            return;
        }
        const previousText = drawingSaveButton ? drawingSaveButton.textContent : '';
        if (drawingSaveButton) {
            drawingSaveButton.disabled = true;
            drawingSaveButton.textContent = 'Saving…';
        }
        try {
            redrawDrawingCanvas();
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = drawingContext.baseWidth || drawingCanvas.width;
            exportCanvas.height = drawingContext.baseHeight || drawingCanvas.height;
            const exportCtx = exportCanvas.getContext('2d');
            if (drawingContext.backgroundImage) {
                exportCtx.drawImage(
                    drawingContext.backgroundImage,
                    0,
                    0,
                    exportCanvas.width,
                    exportCanvas.height
                );
            } else {
                exportCtx.fillStyle = '#ffffff';
                exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
            }
            drawingContext.strokes.forEach((stroke) => {
                exportCtx.strokeStyle = stroke.color;
                exportCtx.lineWidth = Math.max(stroke.size, 1.5);
                exportCtx.lineCap = 'round';
                exportCtx.lineJoin = 'round';
                if (stroke.points.length === 1) {
                    const pt = stroke.points[0];
                    exportCtx.beginPath();
                    exportCtx.arc(pt.x * exportCanvas.width, pt.y * exportCanvas.height, stroke.size / 2, 0, Math.PI * 2);
                    exportCtx.fillStyle = stroke.color;
                    exportCtx.fill();
                } else {
                    exportCtx.beginPath();
                    exportCtx.moveTo(stroke.points[0].x * exportCanvas.width, stroke.points[0].y * exportCanvas.height);
                    for (let i = 1; i < stroke.points.length; i += 1) {
                        exportCtx.lineTo(stroke.points[i].x * exportCanvas.width, stroke.points[i].y * exportCanvas.height);
                    }
                    exportCtx.stroke();
                }
            });
            const dataUrl = exportCanvas.toDataURL('image/png');
            const payload = await uploadDrawingDataUrl(dataUrl);
            drawingData = payload;
            updateDrawingPreview();
            closeDrawingOverlay();
            answerFeedback.textContent = 'Drawing saved. Remember to submit!';
        } catch (error) {
            console.error('Unable to save drawing', error);
            if (answerFeedback) {
                answerFeedback.textContent = 'Could not save drawing. Try again.';
            }
        } finally {
            if (drawingSaveButton) {
                drawingSaveButton.disabled = false;
                drawingSaveButton.textContent = previousText || 'Use drawing';
            }
            updateDrawingControls();
        }
    }

    function updateDrawingControls() {
        const hasStrokes = drawingContext.strokes.length > 0;
        const drawingEnabled = drawingContext.mode === 'draw';
        const pointerActive = drawingContext.pointerId !== null;
        const allowToggle = currentQuestionImages.length > 0 && !respondedThisQuestion;
        if (drawingUndoButton) {
            drawingUndoButton.disabled = !drawingEnabled || !hasStrokes || pointerActive;
        }
        if (drawingClearButton) {
            drawingClearButton.disabled = !drawingEnabled || !hasStrokes || pointerActive;
        }
        if (drawingRemoveButton) {
            drawingRemoveButton.disabled = respondedThisQuestion || !drawingData;
        }
        if (drawingModeToggle) {
            drawingModeToggle.disabled = !allowToggle;
        }
        if (drawingModeFab) {
            drawingModeFab.disabled = !allowToggle;
        }
        updateFabricControls();
    }

    function setFloatingToggleHidden(hidden) {
        if (!drawingModeFab) {
            return;
        }
        if (hidden) {
            drawingModeFab.classList.add('hidden');
        } else {
            drawingModeFab.classList.remove('hidden');
            updateFloatingTogglePosition();
        }
    }

    function loadFabricLibrary() {
        if (window.fabric) {
            return Promise.resolve(window.fabric);
        }
        if (fabricLibraryPromise) {
            return fabricLibraryPromise;
        }
        fabricLibraryPromise = new Promise((resolve, reject) => {
            let index = 0;
            const attempt = () => {
                if (window.fabric) {
                    resolve(window.fabric);
                    return;
                }
                if (index >= FABRIC_LIBRARY_SOURCES.length) {
                    reject(new Error('Unable to load Fabric.js'));
                    return;
                }
                const script = document.createElement('script');
                script.src = FABRIC_LIBRARY_SOURCES[index];
                script.async = true;
                script.onload = () => {
                    if (window.fabric) {
                        resolve(window.fabric);
                    } else {
                        index += 1;
                        attempt();
                    }
                };
                script.onerror = () => {
                    index += 1;
                    attempt();
                };
                document.head.appendChild(script);
            };
            attempt();
        });
        return fabricLibraryPromise;
    }

    async function ensureFabricCanvas() {
        if (!useFabricDrawing || !fabricCanvasElement) {
            return null;
        }
        await loadFabricLibrary();
        if (!window.fabric) {
            throw new Error('Fabric.js failed to load');
        }
        if (!fabricCanvas) {
            fabricCanvas = new fabric.Canvas(fabricCanvasElement, {
                isDrawingMode: true,
                selection: false,
                renderOnAddRemove: true,
            });
            fabricCanvas.setDimensions({ width: 1024, height: 768 });
            fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
            fabricCanvas.freeDrawingBrush.width = parseInt(fabricSizeInput ? fabricSizeInput.value : '6', 10) || 6;
            fabricCanvas.freeDrawingBrush.color = fabricColorInput ? fabricColorInput.value || '#1f2937' : '#1f2937';
            fabricCanvas.defaultCursor = 'crosshair';
            fabricCanvas.setCursor('crosshair');
            fabricCanvas.on('path:created', (opt) => {
                if (opt && opt.path) {
                    opt.path.selectable = false;
                    opt.path.evented = false;
                }
                captureFabricSnapshot();
                updateFabricControls();
            });
            fabricCanvas.on('mouse:down', fabricHandleMouseDown);
            fabricCanvas.on('mouse:move', fabricHandleMouseMove);
            fabricCanvas.on('mouse:up', fabricHandleMouseUp);
            fabricCanvas.on('mouse:wheel', fabricHandleMouseWheel);
            fabricCanvas.on('touch:gesture', fabricHandleTouchGesture);
            fabricCanvas.on('touch:drag', fabricHandleTouchDrag);
            fabricCanvas.on('touch:longpress', fabricHandleTouchLongPress);
            fabricCanvas.on('mouse:out', () => {
                if (fabricIsDragging) {
                    fabricIsDragging = false;
                    fabricCanvas.setCursor('grab');
                }
            });
        }
        return fabricCanvas;
    }

    function updateFabricZoomBounds(canvasWidth, canvasHeight) {
        fabricState.minZoom = DEFAULT_MIN_VIEW_SCALE;
        fabricState.maxZoom = DEFAULT_MAX_VIEW_SCALE;
        const stage = fabricOverlay ? fabricOverlay.querySelector('.fabric-stage') : null;
        if (stage && canvasWidth && canvasHeight) {
            const stageWidth = stage.clientWidth || canvasWidth;
            const stageHeight = stage.clientHeight || canvasHeight;
            if (stageWidth && stageHeight) {
                const fitScale = Math.min(stageWidth / canvasWidth, stageHeight / canvasHeight);
                if (Number.isFinite(fitScale) && fitScale > 0) {
                    fabricState.minZoom = Math.max(0.05, Math.min(DEFAULT_MIN_VIEW_SCALE, fitScale));
                }
            }
        }
        if (fabricState.maxZoom < fabricState.minZoom) {
            fabricState.maxZoom = fabricState.minZoom;
        }
        if (fabricCanvas) {
            const initialZoom = Math.min(1, fabricState.maxZoom);
            const zoom = Math.max(fabricState.minZoom, initialZoom);
            setFabricZoom(zoom, getFabricCanvasCenterPoint());
        }
    }

    function prepareFabricCanvas() {
        if (!fabricCanvas || !fabricCanvasElement) {
            return;
        }
        const backgroundUrl = currentQuestionImages[0] || null;
        const backgroundChanged = fabricState.backgroundUrl !== backgroundUrl;
        fabricState.backgroundUrl = backgroundUrl;
        if (backgroundChanged) {
            fabricState.snapshot = null;
        }
        fabricCanvas.getObjects().slice().forEach((obj) => fabricCanvas.remove(obj));
        fabricCanvas.discardActiveObject();
        fabricCanvas.setBackgroundImage(null, fabricCanvas.renderAll.bind(fabricCanvas));

        const applyDimensions = (width, height) => {
            const safeWidth = width || 1024;
            const safeHeight = height || 768;
            fabricCanvas.setDimensions({ width: safeWidth, height: safeHeight });
            updateFabricZoomBounds(safeWidth, safeHeight);
            fabricCanvas.renderAll();
            restoreFabricSnapshot();
            setFabricMode('draw');
            if (fabricCanvas.freeDrawingBrush) {
                fabricCanvas.freeDrawingBrush.color = fabricColorInput ? fabricColorInput.value || '#1f2937' : '#1f2937';
                fabricCanvas.freeDrawingBrush.width = parseInt(fabricSizeInput ? fabricSizeInput.value : '6', 10) || 6;
            }
            updateFabricControls();
        };

        if (backgroundUrl) {
            fabric.Image.fromURL(backgroundUrl, (img) => {
                const width = img.width || (img._element ? img._element.naturalWidth : 0);
                const height = img.height || (img._element ? img._element.naturalHeight : 0);
                img.set({ selectable: false, evented: false, crossOrigin: 'anonymous' });
                fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas), {
                    originX: 'left',
                    originY: 'top',
                    crossOrigin: 'anonymous',
                });
                applyDimensions(width, height);
            }, { crossOrigin: 'anonymous' });
        } else {
            applyDimensions(0, 0);
        }
    }

    async function openFabricOverlay() {
        if (!useFabricDrawing || !fabricOverlay || !currentQuestionImages.length) {
            return;
        }
        try {
            await ensureFabricCanvas();
            prepareFabricCanvas();
            document.body.style.overflow = 'hidden';
            fabricOverlay.classList.remove('hidden');
            fabricOverlay.setAttribute('tabindex', '-1');
            fabricOverlay.focus();
            updateFabricControls();
        } catch (error) {
            console.error('Unable to initialise Fabric drawing', error);
            if (answerFeedback) {
                answerFeedback.textContent = 'Drawing tool could not load. Please try again later.';
            }
        }
    }

    function closeFabricOverlay() {
        if (!fabricOverlay) {
            return;
        }
        captureFabricSnapshot();
        fabricOverlay.classList.add('hidden');
        fabricOverlay.removeAttribute('tabindex');
        document.body.style.overflow = '';
        fabricIsDragging = false;
        fabricState.lastPanPosition = null;
        if (fabricCanvas) {
            fabricCanvas.isDrawingMode = fabricState.mode === 'draw';
            clampFabricViewport();
        }
    }

    function toggleFabricMode() {
        const nextMode = fabricState.mode === 'draw' ? 'pan' : 'draw';
        setFabricMode(nextMode);
    }

    function setFabricMode(mode) {
        fabricState.mode = mode;
        if (fabricCanvas) {
            const isDraw = mode === 'draw';
            fabricCanvas.isDrawingMode = isDraw;
            fabricCanvas.skipTargetFind = mode === 'pan';
            fabricCanvas.defaultCursor = isDraw ? 'crosshair' : 'grab';
            fabricCanvas.setCursor(isDraw ? 'crosshair' : 'grab');
        }
        if (fabricModeToggle) {
            fabricModeToggle.classList.toggle('active', mode === 'draw');
            fabricModeToggle.textContent = mode === 'draw' ? '🖊' : '🖐';
            fabricModeToggle.title = mode === 'draw'
                ? 'Drawing mode (tap to switch to pan/zoom)'
                : 'Pan/zoom mode (tap to draw)';
            fabricModeToggle.setAttribute('aria-pressed', mode === 'draw');
        }
        updateFabricControls();
    }

    function updateFabricControls() {
        const hasCanvas = Boolean(fabricCanvas);
        const objects = hasCanvas ? fabricCanvas.getObjects().length : 0;
        if (fabricUndoButton) {
            fabricUndoButton.disabled = !hasCanvas || objects === 0;
        }
        if (fabricClearButton) {
            fabricClearButton.disabled = !hasCanvas || objects === 0;
        }
        if (fabricSaveButton) {
            fabricSaveButton.disabled = !hasCanvas || objects === 0;
        }
        if (fabricModeToggle && !hasCanvas) {
            fabricModeToggle.disabled = true;
        } else if (fabricModeToggle) {
            fabricModeToggle.disabled = false;
        }
        if (fabricZoomInButton) {
            const zoom = fabricCanvas ? fabricCanvas.getZoom() || 1 : 1;
            fabricZoomInButton.disabled = !fabricCanvas || zoom >= fabricState.maxZoom - 0.01;
        }
        if (fabricZoomOutButton) {
            const zoom = fabricCanvas ? fabricCanvas.getZoom() || 1 : 1;
            fabricZoomOutButton.disabled = !fabricCanvas || zoom <= fabricState.minZoom + 0.01;
        }
    }

    function captureFabricSnapshot() {
        if (!fabricCanvas) {
            fabricState.snapshot = null;
            return;
        }
        const objects = fabricCanvas.getObjects();
        if (!objects.length) {
            fabricState.snapshot = [];
            return;
        }
        fabricState.snapshot = objects.map((obj) => obj.toObject(['stroke', 'strokeWidth', 'fill', 'path']));
    }

    function restoreFabricSnapshot() {
        if (!fabricCanvas) {
            return;
        }
        fabricCanvas.getObjects().slice().forEach((obj) => fabricCanvas.remove(obj));
        if (fabricState.snapshot && fabricState.snapshot.length) {
            fabric.util.enlivenObjects(fabricState.snapshot, (objects) => {
                objects.forEach((obj) => {
                    obj.selectable = false;
                    obj.evented = false;
                    fabricCanvas.add(obj);
                });
                fabricCanvas.renderAll();
                updateFabricControls();
            });
        } else {
            fabricCanvas.renderAll();
            updateFabricControls();
        }
    }

    function fabricUndo() {
        if (!fabricCanvas) {
            return;
        }
        const objects = fabricCanvas.getObjects();
        if (!objects.length) {
            return;
        }
        const last = objects[objects.length - 1];
        fabricCanvas.remove(last);
        fabricCanvas.requestRenderAll();
        captureFabricSnapshot();
        updateFabricControls();
    }

    function fabricClear() {
        if (!fabricCanvas) {
            return;
        }
        const objects = fabricCanvas.getObjects();
        if (!objects.length) {
            return;
        }
        objects.slice().forEach((obj) => fabricCanvas.remove(obj));
        fabricCanvas.requestRenderAll();
        captureFabricSnapshot();
        updateFabricControls();
    }

    async function saveFabricDrawing() {
        if (!fabricCanvas || !useFabricDrawing) {
            return;
        }
        const objects = fabricCanvas.getObjects();
        if (!objects.length) {
            if (answerFeedback) {
                answerFeedback.textContent = 'Draw something before saving.';
            }
            return;
        }
        const previousText = fabricSaveButton ? fabricSaveButton.textContent : '';
        if (fabricSaveButton) {
            fabricSaveButton.disabled = true;
            fabricSaveButton.textContent = 'Saving…';
        }
        try {
            const dataUrl = exportFabricDrawingDataUrl();
            if (!dataUrl) {
                throw new Error('Unable to export drawing');
            }
            const payload = await uploadDrawingDataUrl(dataUrl);
            drawingData = payload;
            updateDrawingPreview();
            closeFabricOverlay();
            captureFabricSnapshot();
            if (answerFeedback) {
                answerFeedback.textContent = 'Drawing saved. Remember to submit!';
            }
        } catch (error) {
            console.error('Unable to save drawing', error);
            if (answerFeedback) {
                answerFeedback.textContent = 'Could not save drawing. Try again.';
            }
        } finally {
            if (fabricSaveButton) {
                fabricSaveButton.disabled = false;
                fabricSaveButton.textContent = previousText || 'Use drawing';
            }
            updateFabricControls();
        }
    }

    function exportFabricDrawingDataUrl() {
        if (!fabricCanvas) {
            return null;
        }
        const viewport = fabricCanvas.viewportTransform ? fabricCanvas.viewportTransform.slice() : null;
        const width = fabricCanvas.getWidth() || 1024;
        const height = fabricCanvas.getHeight() || 768;

        fabricCanvas.discardActiveObject();
        fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        fabricCanvas.renderAll();

        const dataUrl = fabricCanvas.toDataURL({
            format: 'png',
            width,
            height,
            left: 0,
            top: 0,
            enableRetinaScaling: true,
            withoutTransform: true,
        });

        if (viewport) {
            fabricCanvas.setViewportTransform(viewport);
        }
        fabricCanvas.renderAll();
        return dataUrl;
    }

    function fabricHandleMouseDown(opt) {
        if (!fabricCanvas || fabricState.mode !== 'pan') {
            return;
        }
        const point = getFabricEventPoint(opt.e);
        if (!point) {
            return;
        }
        fabricIsDragging = true;
        fabricState.lastPanPosition = point;
        fabricCanvas.setCursor('grabbing');
        opt.e.preventDefault();
        if (opt.e && typeof opt.e.stopPropagation === 'function') {
            opt.e.stopPropagation();
        }
    }

    function fabricHandleMouseMove(opt) {
        if (!fabricCanvas || !fabricIsDragging || fabricState.mode !== 'pan') {
            return;
        }
        const point = getFabricEventPoint(opt.e);
        if (!point || !fabricState.lastPanPosition) {
            return;
        }
        const dx = point.x - fabricState.lastPanPosition.x;
        const dy = point.y - fabricState.lastPanPosition.y;
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
            return;
        }
        fabricCanvas.relativePan(new fabric.Point(dx, dy));
        clampFabricViewport();
        fabricState.lastPanPosition = point;
        fabricCanvas.requestRenderAll();
        opt.e.preventDefault();
        if (opt.e && typeof opt.e.stopPropagation === 'function') {
            opt.e.stopPropagation();
        }
    }

    function fabricHandleMouseUp(opt) {
        if (!fabricCanvas) {
            return;
        }
        if (fabricIsDragging) {
            fabricIsDragging = false;
            fabricCanvas.setCursor(fabricState.mode === 'pan' ? 'grab' : 'crosshair');
        }
        fabricState.lastPanPosition = null;
        fabricCanvas.isDrawingMode = fabricState.mode === 'draw';
        clampFabricViewport();
        fabricCanvas.requestRenderAll();
        if (opt && opt.e && typeof opt.e.stopPropagation === 'function') {
            opt.e.stopPropagation();
        }
    }

    function fabricHandleMouseWheel(opt) {
        if (!fabricCanvas) {
            return;
        }
        let zoom = fabricCanvas.getZoom();
        zoom *= 0.999 ** opt.e.deltaY;
        zoom = clamp(zoom, fabricState.minZoom, fabricState.maxZoom);
        const rect = fabricCanvasElement ? fabricCanvasElement.getBoundingClientRect() : { left: 0, top: 0 };
        const pointer = getFabricEventPoint(opt.e) || { x: rect.left, y: rect.top };
        const point = new fabric.Point(pointer.x - rect.left, pointer.y - rect.top);
        setFabricZoom(zoom, point);
        opt.e.preventDefault();
        opt.e.stopPropagation();
    }

    function fabricHandleTouchGesture(opt) {
        if (!fabricCanvas || !opt.e.touches || opt.e.touches.length !== 2) {
            return;
        }
        if (fabricState.mode === 'draw' && opt.self.state === 'start') {
            fabricCanvas.isDrawingMode = false;
        }
        if (opt.self.state === 'start') {
            fabricCanvas.__gestureZoom = fabricCanvas.getZoom();
            fabricState.lastPanPosition = { x: opt.self.x, y: opt.self.y };
        }
        const baseZoom = fabricCanvas.__gestureZoom || fabricCanvas.getZoom();
        let zoom = baseZoom * opt.self.scale;
        zoom = clamp(zoom, fabricState.minZoom, fabricState.maxZoom);
        const rect = fabricCanvasElement ? fabricCanvasElement.getBoundingClientRect() : { left: 0, top: 0 };
        const center = new fabric.Point(opt.self.x - rect.left, opt.self.y - rect.top);
        setFabricZoom(zoom, center);
        if (fabricState.mode === 'draw' && opt.self.state === 'end') {
            fabricCanvas.isDrawingMode = true;
        }
        if (opt.self.state === 'end') {
            fabricState.lastPanPosition = null;
        }
        opt.e.preventDefault();
        opt.e.stopPropagation();
    }

    function fabricHandleTouchDrag(opt) {
        if (!fabricCanvas || !opt.e.touches || opt.e.touches.length !== 2) {
            fabricState.lastPanPosition = null;
            fabricCanvas.isDrawingMode = fabricState.mode === 'draw';
            return;
        }
        if (fabricState.mode === 'draw') {
            fabricCanvas.isDrawingMode = false;
        }
        if (fabricState.lastPanPosition) {
            const dx = opt.self.x - fabricState.lastPanPosition.x;
            const dy = opt.self.y - fabricState.lastPanPosition.y;
            if (Number.isFinite(dx) && Number.isFinite(dy)) {
                fabricCanvas.relativePan(new fabric.Point(dx, dy));
                clampFabricViewport();
                fabricCanvas.requestRenderAll();
            }
        }
        fabricState.lastPanPosition = { x: opt.self.x, y: opt.self.y };
        opt.e.preventDefault();
        opt.e.stopPropagation();
    }

    function fabricHandleTouchLongPress(opt) {
        if (!fabricCanvas || fabricState.mode !== 'pan') {
            return;
        }
        fabricState.lastPanPosition = { x: opt.self.x, y: opt.self.y };
    }

    function updateViewScaleBounds() {
        if (useFabricDrawing) {
            return;
        }
        const transform = drawingContext.viewTransform;
        if (!transform) {
            return;
        }
        transform.maxScale = DEFAULT_MAX_VIEW_SCALE;
        let minScale = DEFAULT_MIN_VIEW_SCALE;
        if (drawingCanvas && drawingContent) {
            const canvasWidth = drawingCanvas.width || 0;
            const canvasHeight = drawingCanvas.height || 0;
            const viewportWidth = drawingContent.clientWidth || 0;
            const viewportHeight = drawingContent.clientHeight || 0;
            if (canvasWidth && canvasHeight && viewportWidth && viewportHeight) {
                const fitScale = Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight);
                if (Number.isFinite(fitScale) && fitScale > 0) {
                    minScale = Math.min(DEFAULT_MIN_VIEW_SCALE, fitScale);
                }
            }
        }
        transform.minScale = Math.max(0.1, minScale);
        if (transform.maxScale < transform.minScale) {
            transform.maxScale = transform.minScale;
        }
        transform.scale = clamp(transform.scale, transform.minScale, transform.maxScale);
        if (!viewInteraction.isPinching) {
            viewInteraction.initialScale = transform.scale;
            viewInteraction.initialDistance = 0;
        }
    }

    function distanceBetween(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function updateViewScale(screenCenter, newScale) {
        const transform = drawingContext.viewTransform;
        const currentScale = transform.scale || 1;
        const contentCenter = {
            x: (screenCenter.x - transform.translateX) / currentScale,
            y: (screenCenter.y - transform.translateY) / currentScale,
        };
        const clampedScale = clamp(newScale, transform.minScale, transform.maxScale);
        transform.scale = clampedScale;
        transform.translateX = screenCenter.x - contentCenter.x * clampedScale;
        transform.translateY = screenCenter.y - contentCenter.y * clampedScale;
        applyViewTransform();
    }

    function resetViewTransform() {
        if (useFabricDrawing) {
            return;
        }
        updateViewScaleBounds();
        const transform = drawingContext.viewTransform;
        transform.scale = clamp(1, transform.minScale, transform.maxScale);
        transform.translateX = 0;
        transform.translateY = 0;
        viewInteraction.pointers.clear();
        viewInteraction.initialDistance = 0;
        viewInteraction.initialScale = transform.scale;
        viewInteraction.isPinching = false;
        applyViewTransform();
    }

    function clampViewTransform() {
        if (useFabricDrawing) {
            return;
        }
        const transform = drawingContext.viewTransform;
        transform.scale = clamp(transform.scale, transform.minScale, transform.maxScale);
        if (!drawingCanvas || !drawingContent) {
            return;
        }
        const contentRect = drawingContent.getBoundingClientRect();
        if (!contentRect.width || !contentRect.height) {
            return;
        }
        const baseWidth = drawingCanvas.width || contentRect.width || 1;
        const baseHeight = drawingCanvas.height || contentRect.height || 1;
        const scaledWidth = baseWidth * transform.scale;
        const scaledHeight = baseHeight * transform.scale;
        const minTranslateX = Math.min(0, contentRect.width - scaledWidth);
        const maxTranslateX = Math.max(0, contentRect.width - scaledWidth);
        const minTranslateY = Math.min(0, contentRect.height - scaledHeight);
        const maxTranslateY = Math.max(0, contentRect.height - scaledHeight);
        transform.translateX = clamp(transform.translateX, minTranslateX, maxTranslateX);
        transform.translateY = clamp(transform.translateY, minTranslateY, maxTranslateY);
    }

    function applyViewTransform() {
        if (useFabricDrawing) {
            return;
        }
        if (!drawingStage) {
            return;
        }
        clampViewTransform();
        drawingStage.style.transformOrigin = '0 0';
        const { scale, translateX, translateY } = drawingContext.viewTransform;
        drawingStage.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    }

    function handleStageTouch(event) {
        if (useFabricDrawing) {
            return;
        }
        if (drawingContext.mode !== 'draw') {
            return;
        }
        if (event.target === drawingCanvas || event.target === drawingModeFab) {
            return;
        }
        event.preventDefault();
    }

    function getViewportMetrics() {
        const viewport = window.visualViewport;
        if (viewport) {
            return {
                offsetLeft: viewport.offsetLeft,
                offsetTop: viewport.offsetTop,
                width: viewport.width,
                height: viewport.height,
            };
        }
        return {
            offsetLeft: window.pageXOffset || 0,
            offsetTop: window.pageYOffset || 0,
            width: window.innerWidth || 0,
            height: window.innerHeight || 0,
        };
    }

    function syncFloatingToggleWithViewport(enable) {
        if (!drawingModeFab) {
            return;
        }
        if (detachViewportSync) {
            detachViewportSync();
            detachViewportSync = null;
        }
        if (!enable) {
            resetFloatingTogglePosition();
            return;
        }
        if (window.visualViewport) {
            const handleViewportChange = () => {
                window.requestAnimationFrame(updateFloatingTogglePosition);
            };
            window.visualViewport.addEventListener('resize', handleViewportChange);
            window.visualViewport.addEventListener('scroll', handleViewportChange);
            detachViewportSync = () => {
                window.visualViewport.removeEventListener('resize', handleViewportChange);
                window.visualViewport.removeEventListener('scroll', handleViewportChange);
            };
        }
        updateFloatingTogglePosition();
    }

    function resetFloatingTogglePosition() {
        customFabPosition = null;
        skipNextFabClick = false;
        fabDragState = null;
        if (!drawingModeFab) {
            return;
        }
        drawingModeFab.style.top = '';
        drawingModeFab.style.left = '';
        drawingModeFab.style.right = '';
        drawingModeFab.style.bottom = '';
    }

    function updateFloatingTogglePosition() {
        if (!drawingModeFab) {
            return;
        }
        const viewport = getViewportMetrics();
        const margin = viewport.width < 520 ? 16 : 20;
        const fabWidth = drawingModeFab.offsetWidth || 48;
        const fabHeight = drawingModeFab.offsetHeight || 48;

        let minLeft = viewport.offsetLeft + margin;
        let maxLeft = viewport.offsetLeft + viewport.width - fabWidth - margin;
        if (maxLeft < minLeft) {
            const center = viewport.offsetLeft + (viewport.width - fabWidth) / 2;
            minLeft = center;
            maxLeft = center;
        }

        let minTop = viewport.offsetTop + margin;
        let maxTop = viewport.offsetTop + viewport.height - fabHeight - margin;
        if (maxTop < minTop) {
            const middle = viewport.offsetTop + (viewport.height - fabHeight) / 2;
            minTop = middle;
            maxTop = middle;
        }

        let left;
        let top;
        if (customFabPosition && typeof customFabPosition.leftRatio === 'number' && typeof customFabPosition.topRatio === 'number') {
            const horizontalSpan = Math.max(maxLeft - minLeft, 0);
            const verticalSpan = Math.max(maxTop - minTop, 0);
            left = horizontalSpan > 0 ? minLeft + clamp(customFabPosition.leftRatio, 0, 1) * horizontalSpan : minLeft;
            top = verticalSpan > 0 ? minTop + clamp(customFabPosition.topRatio, 0, 1) * verticalSpan : minTop;
        } else {
            left = maxLeft;
            top = maxTop;
        }

        left = clamp(left, minLeft, maxLeft);
        top = clamp(top, minTop, maxTop);

        drawingModeFab.style.right = 'auto';
        drawingModeFab.style.bottom = 'auto';
        drawingModeFab.style.left = `${left}px`;
        drawingModeFab.style.top = `${top}px`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function clampFabricViewport() {
        if (!fabricCanvas) {
            return;
        }
        const vpt = fabricCanvas.viewportTransform;
        if (!vpt) {
            return;
        }
        const zoom = fabricCanvas.getZoom() || 1;
        const canvasWidth = fabricCanvas.getWidth() || 0;
        const canvasHeight = fabricCanvas.getHeight() || 0;
        const stage = fabricOverlay ? fabricOverlay.querySelector('.fabric-stage') : null;
        const stageWidth = stage ? stage.clientWidth || canvasWidth : canvasWidth;
        const stageHeight = stage ? stage.clientHeight || canvasHeight : canvasHeight;
        if (!canvasWidth || !canvasHeight || !stageWidth || !stageHeight) {
            return;
        }
        const scaledWidth = canvasWidth * zoom;
        const scaledHeight = canvasHeight * zoom;
        const minX = Math.min(0, stageWidth - scaledWidth);
        const maxX = Math.max(0, stageWidth - scaledWidth);
        const minY = Math.min(0, stageHeight - scaledHeight);
        const maxY = Math.max(0, stageHeight - scaledHeight);
        vpt[4] = clamp(vpt[4], minX, maxX);
        vpt[5] = clamp(vpt[5], minY, maxY);
        fabricCanvas.requestRenderAll();
    }

    function showQuestionMessage(message) {
        questionText.textContent = message;
        questionText.classList.remove('hidden');
    }

    function hideQuestionText() {
        questionText.textContent = '';
        questionText.classList.add('hidden');
    }

    function handleMissingSession() {
        stopPolling();
        joined = false;
        activeSessionCode = null;
        statusMessage.textContent = 'Session not found or has ended. Enter a new code to join again.';
        joinSection.classList.remove('hidden');
        questionSection.classList.add('hidden');
        answerInput.value = '';
        respondedThisQuestion = false;
        sessionCodeInput.readOnly = false;
        sessionCodeInput.removeAttribute('aria-readonly');
        setStudentNameBanner('');
        resetDrawingState();
        updateDrawingAvailability();
    }

    fetchState();
})();
