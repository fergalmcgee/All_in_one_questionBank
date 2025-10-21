(function () {
    const form = document.getElementById('session-form');
    const bankSelect = document.getElementById('bank-select');
    const sessionInfo = document.getElementById('session-info');
    const joinUrlEl = document.getElementById('join-url');
    const sessionCodeEl = document.getElementById('session-code');
    const qrImg = document.getElementById('join-qr');
    const questionTextEl = document.getElementById('question-text');
    const questionImagesEl = document.getElementById('question-images');
    const questionTopicEl = document.getElementById('question-topic');
    const questionProgressEl = document.getElementById('question-progress');
    const answerReveal = document.getElementById('answer-reveal');
    const answerTextEl = document.getElementById('answer-text');
    const answerImagesEl = document.getElementById('answer-images');
    const board = document.getElementById('answers-grid');
    const revealButton = document.getElementById('reveal-button');
    const nextButton = document.getElementById('next-button');
    const resetButton = document.getElementById('reset-button');
    const sessionBuilder = document.getElementById('session-builder');
    const builderSummary = document.getElementById('builder-summary');
    const topicList = document.getElementById('topic-list');
    const questionList = document.getElementById('question-list');
    const selectedList = document.getElementById('selected-questions');
    const addAllButton = document.getElementById('add-all-button');
    const clearSelectionButton = document.getElementById('clear-selection');
    const toggleTopicsButton = document.getElementById('toggle-topics');
    const logoutForm = document.querySelector('.logout-form');
    const manualToggleButton = document.getElementById('manual-question-toggle');
    const manualPanel = document.getElementById('manual-question-panel');
    const manualQuestionInput = document.getElementById('manual-question-text');
    const manualAnswerInput = document.getElementById('manual-answer-text');
    const manualQuestionDrop = document.getElementById('manual-question-drop');
    const manualAnswerDrop = document.getElementById('manual-answer-drop');
    const manualQuestionPreview = document.getElementById('manual-question-preview');
    const manualAnswerPreview = document.getElementById('manual-answer-preview');
    const manualSubmitButton = document.getElementById('manual-question-submit');
    const manualCancelButton = document.getElementById('manual-question-cancel');
    const manualError = document.getElementById('manual-question-error');
    const manualQuestionLibraryButton = document.getElementById('manual-question-library');
    const manualAnswerLibraryButton = document.getElementById('manual-answer-library');
    const manualLibraryOverlay = document.getElementById('manual-library-overlay');
    const manualLibraryContent = document.getElementById('manual-library-content');
    const manualLibraryClose = document.getElementById('manual-library-close');
    const templateControls = document.getElementById('template-controls');
    const templateNameInput = document.getElementById('template-name');
    const templateSaveButton = document.getElementById('template-save-button');
    const templateSelect = document.getElementById('template-select');
    const templateLoadButton = document.getElementById('template-load-button');
    const templateDeleteButton = document.getElementById('template-delete-button');
    const templateFeedback = document.getElementById('template-feedback');
    const questionSearchInput = document.getElementById('question-search');
    const questionSearchClear = document.getElementById('question-search-clear');
    const previewOverlay = document.getElementById('question-preview-overlay');
    const previewTitle = document.getElementById('question-preview-title');
    const previewBody = document.getElementById('question-preview-body');
    const previewClose = document.getElementById('question-preview-close');
    const timerPanel = document.getElementById('timer-panel');
    const timerDisplay = document.getElementById('timer-display');
    const timerMinutesInput = document.getElementById('timer-minutes');
    const timerSecondsInput = document.getElementById('timer-seconds');
    const timerStartButton = document.getElementById('timer-start');
    const timerResetButton = document.getElementById('timer-reset');

    const POLL_INTERVAL = 2500;
    const SESSION_CODE_STORAGE_KEY = 'qrt_active_session_code';
    const responsePositions = new Map();
let pollTimer = null;
let activeSessionCode = null;
let responseZCounter = 1;
const dragState = {
    key: null,
    offsetX: 0,
    offsetY: 0,
};
let timerInterval = null;
let timerRemaining = 0;
let timerRunning = false;
let timerTarget = null;

    const builderState = {
        bankId: null,
        outline: null,
        selectedTopics: new Set(),
        questionLookup: new Map(),
        queue: [],
        customQuestions: new Map(),
        searchTerm: ''
    };

    const bankLabelMap = new Map();
    if (Array.isArray(window.__BANK_OPTIONS__)) {
        window.__BANK_OPTIONS__.forEach((bank) => {
            if (bank && bank.id) {
                bankLabelMap.set(bank.id, bank.label || bank.id);
            }
        });
    }

    const templateState = {
        templates: [],
        busy: false
    };

    const questionPreviewCache = new Map();
    const previewState = {
        open: false,
        loading: false,
        questionId: null,
        lastFocus: null
    };

    bankSelect.addEventListener('change', async (event) => {
        const bankId = event.target.value;
        if (!bankId) {
            hideSessionBuilder();
            resetBuilderState();
            return;
        }
        await loadOutline(bankId);
    });

    addAllButton.addEventListener('click', () => {
        addFilteredQuestionsToQueue();
    });

    clearSelectionButton.addEventListener('click', () => {
        builderState.queue = [];
        builderState.customQuestions.clear();
        renderBuilder();
    });

    toggleTopicsButton.addEventListener('click', () => {
        toggleAllTopics();
    });

    if (questionSearchInput) {
        questionSearchInput.addEventListener('input', (event) => {
            builderState.searchTerm = event.target.value;
            renderBuilder();
        });
    }

    if (questionSearchClear) {
        questionSearchClear.addEventListener('click', () => {
            builderState.searchTerm = '';
            if (questionSearchInput) {
                questionSearchInput.value = '';
                questionSearchInput.focus();
            }
            renderBuilder();
        });
    }

    if (logoutForm) {
        logoutForm.addEventListener('submit', () => {
            localStorage.removeItem(SESSION_CODE_STORAGE_KEY);
            activeSessionCode = null;
        });
    }

    if (templateNameInput) {
        templateNameInput.addEventListener('input', () => {
            setTemplateFeedbackMessage('');
        });
    }

    if (templateSelect) {
        templateSelect.addEventListener('change', () => {
            setTemplateFeedbackMessage('');
            updateTemplateActionState();
        });
    }

    if (templateSaveButton) {
        templateSaveButton.addEventListener('click', async () => {
            if (!builderState.bankId && bankSelect && bankSelect.value) {
                builderState.bankId = bankSelect.value;
            }
            if (!builderState.bankId) {
                setTemplateFeedbackMessage('Select a question bank before saving a template.', 'error');
                return;
            }
            if (builderState.queue.length === 0) {
                setTemplateFeedbackMessage('Add at least one question before saving a template.', 'error');
                return;
            }
            const name = templateNameInput ? templateNameInput.value.trim() : '';
            if (!name) {
                setTemplateFeedbackMessage('Enter a name for the template.', 'error');
                if (templateNameInput) {
                    templateNameInput.focus();
                }
                return;
            }

            setTemplateBusy(true);
            try {
                const payload = createTemplatePayload(name);
                if (!payload.bank_id) {
                    throw new Error('bank_id is required');
                }
                const response = await fetch('/api/templates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) {
                    const message = await extractErrorMessage(response, 'Unable to save template.');
                    throw new Error(message);
                }
                const data = await response.json();
                if (templateNameInput) {
                    templateNameInput.value = '';
                }
                const newId = data && data.template ? data.template.id : null;
                await refreshTemplates(newId || undefined, { silent: true });
                if (templateSelect && newId) {
                    templateSelect.value = newId;
                }
                setTemplateFeedbackMessage('Template saved.', 'success');
            } catch (error) {
                console.error('Unable to save template', error);
                setTemplateFeedbackMessage(error.message || 'Unable to save template.', 'error');
            } finally {
                setTemplateBusy(false);
            }
        });
    }

    if (templateLoadButton) {
        templateLoadButton.addEventListener('click', async () => {
            const templateId = templateSelect ? templateSelect.value : '';
            if (!templateId) {
                setTemplateFeedbackMessage('Select a template to load.', 'error');
                return;
            }
            await applyTemplate(templateId);
        });
    }

    if (templateDeleteButton) {
        templateDeleteButton.addEventListener('click', async () => {
            const templateId = templateSelect ? templateSelect.value : '';
            if (!templateId) {
                setTemplateFeedbackMessage('Select a template to delete.', 'error');
                return;
            }
            const template = findTemplate(templateId);
            const templateName = template ? template.name : 'this template';
            if (!window.confirm(`Delete ${templateName}? This cannot be undone.`)) {
                return;
            }
            setTemplateBusy(true);
            setTemplateFeedbackMessage('');
            try {
                const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
                    method: 'DELETE'
                });
                if (!response.ok) {
                    const message = await extractErrorMessage(response, 'Unable to delete template.');
                    throw new Error(message);
                }
                await refreshTemplates(undefined, { silent: true });
                if (templateSelect) {
                    templateSelect.value = '';
                }
                setTemplateFeedbackMessage('Template deleted.', 'success');
            } catch (error) {
                console.error('Unable to delete template', error);
                setTemplateFeedbackMessage(error.message || 'Unable to delete template.', 'error');
            } finally {
                setTemplateBusy(false);
            }
        });
    }

    const manualState = {
        open: false,
        questionImages: [],
        answerImages: [],
        submitting: false,
        uploading: 0
    };
    let manualLibraryCache = null;
    let manualLibraryTarget = null;
    let manualLibraryPreview = null;

    if (manualToggleButton) {
        manualToggleButton.addEventListener('click', () => {
            manualState.open = !manualState.open;
            renderManualPanel();
        });
    }

    if (manualCancelButton) {
        manualCancelButton.addEventListener('click', () => {
            resetManualForm();
            manualState.open = false;
            renderManualPanel();
        });
    }

    if (manualSubmitButton) {
        manualSubmitButton.addEventListener('click', handleManualSubmit);
    }

    if (manualQuestionInput) {
        manualQuestionInput.addEventListener('input', () => {
            if (manualError) {
                manualError.textContent = '';
            }
            updateManualSubmitState();
        });
    }

    if (manualAnswerInput) {
        manualAnswerInput.addEventListener('input', () => {
            if (manualError) {
                manualError.textContent = '';
            }
        });
    }

    if (manualAnswerInput) {
        manualAnswerInput.addEventListener('input', () => {
            if (manualError) {
                manualError.textContent = '';
            }
        });
    }

    if (manualQuestionLibraryButton) {
        manualQuestionLibraryButton.addEventListener('click', () => {
            openManualLibrary(manualState.questionImages, manualQuestionPreview);
        });
    }

    if (manualAnswerLibraryButton) {
        manualAnswerLibraryButton.addEventListener('click', () => {
            openManualLibrary(manualState.answerImages, manualAnswerPreview);
        });
    }

    if (manualLibraryClose) {
        manualLibraryClose.addEventListener('click', closeManualLibrary);
    }

    if (manualLibraryOverlay) {
        manualLibraryOverlay.addEventListener('click', (event) => {
            if (event.target === manualLibraryOverlay) {
                closeManualLibrary();
            }
        });
        manualLibraryOverlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeManualLibrary();
            }
        });
    }

    if (previewClose) {
        previewClose.addEventListener('click', closeQuestionPreview);
    }

    if (previewOverlay) {
        previewOverlay.addEventListener('click', (event) => {
            if (event.target === previewOverlay) {
                closeQuestionPreview();
            }
        });
        previewOverlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeQuestionPreview();
            }
        });
    }

    if (timerStartButton) {
        timerStartButton.addEventListener('click', toggleTimer);
    }

    if (timerResetButton) {
        timerResetButton.addEventListener('click', resetTimer);
    }

    [timerMinutesInput, timerSecondsInput].forEach((input) => {
        if (!input) {
            return;
        }
        input.addEventListener('input', () => {
            if (input === timerMinutesInput) {
                const value = clampNumber(parseInt(input.value, 10), 0, 99);
                input.value = Number.isFinite(value) ? value.toString() : '';
            } else {
                const value = clampNumber(parseInt(input.value, 10), 0, 59);
                input.value = Number.isFinite(value) ? value.toString().padStart(2, '0') : '';
            }
            if (!timerRunning) {
                timerRemaining = 0;
                updateTimerDisplay();
                timerPanel?.classList.remove('timer-running', 'timer-finished');
                timerStartButton.textContent = 'Start';
            }
        });
        input.addEventListener('focus', () => {
            input.select();
        });
    });

    updateTimerDisplay();

    setupDropZone(manualQuestionDrop, manualState.questionImages, manualQuestionPreview);
    setupDropZone(manualAnswerDrop, manualState.answerImages, manualAnswerPreview);
    renderManualPanel();
    renderFilePreview(manualState.questionImages, manualQuestionPreview);
    renderFilePreview(manualState.answerImages, manualAnswerPreview);

    function renderManualPanel() {
        if (!manualPanel) {
            return;
        }
        if (manualState.open) {
            manualPanel.classList.remove('hidden');
            if (manualToggleButton) {
                manualToggleButton.textContent = 'Hide manual form';
            }
            if (manualQuestionInput) {
                manualQuestionInput.focus();
            }
        } else {
            manualPanel.classList.add('hidden');
            if (manualToggleButton) {
                manualToggleButton.textContent = 'New manual question';
            }
        }
        updateManualSubmitState();
    }

    function resetManualForm() {
        if (manualQuestionInput) {
            manualQuestionInput.value = '';
        }
        if (manualAnswerInput) {
            manualAnswerInput.value = '';
        }
        manualState.questionImages = [];
        manualState.answerImages = [];
        manualState.uploading = 0;
        if (manualError) {
            manualError.textContent = '';
        }
        renderFilePreview(manualState.questionImages, manualQuestionPreview);
        renderFilePreview(manualState.answerImages, manualAnswerPreview);
        updateManualSubmitState();
    }

    function updateManualSubmitState() {
        if (!manualSubmitButton) {
            return;
        }
        if (manualState.submitting) {
            manualSubmitButton.disabled = true;
            return;
        }
        const hasPrompt = manualQuestionInput && manualQuestionInput.value.trim().length > 0;
        const hasImages = manualState.questionImages.length > 0;
        if (manualState.uploading > 0) {
            manualSubmitButton.disabled = true;
            manualSubmitButton.textContent = 'Waiting for uploads…';
        } else {
            manualSubmitButton.disabled = !(hasPrompt || hasImages);
            manualSubmitButton.textContent = 'Add to queue';
        }
    }

    function setupDropZone(zone, targetList, preview) {
        if (!zone || !preview) {
            return;
        }

        const acceptFiles = (files) => {
            if (!files) {
                return;
            }
            const valid = Array.from(files).filter((file) => file && file.type && file.type.startsWith('image/'));
            if (valid.length === 0) {
                if (manualError) {
                    manualError.textContent = 'Only image files are supported.';
                }
                return;
            }
            valid.forEach((file) => {
                uploadImageImmediate(file, targetList, preview);
            });
        };

        zone.addEventListener('dragover', (event) => {
            event.preventDefault();
            zone.classList.add('active');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('active'));
        zone.addEventListener('drop', (event) => {
            event.preventDefault();
            zone.classList.remove('active');
            acceptFiles(event.dataTransfer.files);
        });
        zone.addEventListener('paste', (event) => {
            if (event.clipboardData && event.clipboardData.files.length) {
                acceptFiles(event.clipboardData.files);
                event.preventDefault();
            }
        });
        zone.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                zone.classList.remove('active');
            }
        });
    }

    function renderFilePreview(list, container) {
        if (!container) {
            return;
        }
        container.innerHTML = '';
        if (!list || list.length === 0) {
            return;
        }
        list.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'drop-preview-item';
            if (entry.url) {
                const thumb = document.createElement('img');
                thumb.src = entry.url;
                thumb.alt = entry.name || 'Manual image';
                thumb.className = 'drop-preview-thumb';
                item.appendChild(thumb);
            }
            const name = document.createElement('span');
            name.textContent = entry.name || `image-${index + 1}`;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.addEventListener('click', () => {
                list.splice(index, 1);
                renderFilePreview(list, container);
                updateManualSubmitState();
            });
            item.append(name, remove);
            container.appendChild(item);
        });
    }

    function uploadImageImmediate(file, targetList, preview) {
        manualState.uploading += 1;
        updateManualSubmitState();
        const formData = new FormData();
        formData.append('file', file);
        return fetch('/api/presenter/upload-image', {
            method: 'POST',
            body: formData
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Upload failed');
                }
                return response.json();
            })
            .then((data) => {
                if (data && data.url && !targetList.some((entry) => entry.url === data.url)) {
                    targetList.push({
                        name: file.name || data.filename || `image-${targetList.length + 1}`,
                        url: data.url
                    });
                    renderFilePreview(targetList, preview);
                    if (manualError) {
                        manualError.textContent = '';
                    }
                }
            })
            .catch((error) => {
                console.error('Upload failed', error);
                if (manualError) {
                    manualError.textContent = 'Could not upload image. Please try again.';
                }
            })
            .finally(() => {
                manualState.uploading = Math.max(0, manualState.uploading - 1);
                updateManualSubmitState();
            });
    }

    function openManualLibrary(targetList, preview) {
        if (!manualLibraryOverlay || !manualLibraryContent) {
            return;
        }
        manualLibraryTarget = targetList;
        manualLibraryPreview = preview;
        if (manualError) {
            manualError.textContent = '';
        }
        manualLibraryOverlay.classList.remove('hidden');
        manualLibraryOverlay.setAttribute('tabindex', '-1');
        manualLibraryOverlay.focus();
        manualLibraryContent.innerHTML = '<p>Loading images…</p>';
        if (manualLibraryCache) {
            renderManualLibrary(manualLibraryCache);
        } else {
            fetch('/api/presenter/user-images')
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('Failed to load images');
                    }
                    return response.json();
                })
                .then((data) => {
                    manualLibraryCache = (data && Array.isArray(data.images)) ? data.images : [];
                    renderManualLibrary(manualLibraryCache);
                })
                .catch((error) => {
                    console.error('Unable to load saved images', error);
                    manualLibraryContent.innerHTML = '<p class="manual-error">Could not load saved images.</p>';
                });
        }
    }

    function closeManualLibrary() {
        if (!manualLibraryOverlay) {
            return;
        }
        manualLibraryOverlay.classList.add('hidden');
        manualLibraryOverlay.removeAttribute('tabindex');
        manualLibraryTarget = null;
        manualLibraryPreview = null;
    }

    function renderManualLibrary(items) {
        if (!manualLibraryContent) {
            return;
        }
        if (!items || items.length === 0) {
            manualLibraryContent.innerHTML = '<p>No saved images yet. Upload one to get started.</p>';
            return;
        }
        manualLibraryContent.innerHTML = '';
        items.forEach((item) => {
            if (!item || !item.url) {
                return;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-item';
            button.innerHTML = `
                <img src="${item.url}" alt="Saved image" />
                <span>${escapeHtml(item.filename || 'image')}</span>
            `;
            button.addEventListener('click', () => {
                if (!manualLibraryTarget || manualLibraryTarget.some((entry) => entry.url === item.url)) {
                    closeManualLibrary();
                    return;
                }
                manualLibraryTarget.push({
                    name: item.filename || 'image',
                    url: item.url,
                });
                if (manualLibraryPreview) {
                    renderFilePreview(manualLibraryTarget, manualLibraryPreview);
                }
                if (manualError) {
                    manualError.textContent = '';
                }
                updateManualSubmitState();
                closeManualLibrary();
            });
            manualLibraryContent.appendChild(button);
        });
    }

    async function handleManualSubmit() {
        if (manualState.submitting || manualState.uploading > 0) {
            if (manualState.uploading > 0 && manualError) {
                manualError.textContent = 'Please wait for uploads to finish.';
            }
            return;
        }
        if (!manualQuestionInput || !manualAnswerInput) {
            return;
        }
        const prompt = manualQuestionInput.value.trim();
        const answer = manualAnswerInput.value.trim();
        if (!prompt && manualState.questionImages.length === 0) {
            if (manualError) {
                manualError.textContent = 'Add question text or at least one image.';
            }
            return;
        }
        if (manualError) {
            manualError.textContent = '';
        }
        manualState.submitting = true;
        if (manualSubmitButton) {
            manualSubmitButton.disabled = true;
            manualSubmitButton.textContent = 'Adding…';
        }
        try {
            const customId = `custom-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
            const customData = {
                id: customId,
                text: prompt,
                answer_text: answer,
                question_images: manualState.questionImages.map((entry) => entry.url),
                answer_images: manualState.answerImages.map((entry) => entry.url)
            };
            builderState.customQuestions.set(customId, customData);
            builderState.queue.push({ type: 'custom', id: customId });
            resetManualForm();
            manualState.open = false;
            renderManualPanel();
            renderBuilder();
        } catch (error) {
            console.error('Unable to add manual question', error);
            if (manualError) {
                manualError.textContent = 'Could not add manual question. Please try again.';
            }
        } finally {
            manualState.submitting = false;
            if (manualSubmitButton) {
                manualSubmitButton.disabled = false;
                manualSubmitButton.textContent = 'Add to queue';
            }
            updateManualSubmitState();
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const bankId = bankSelect.value;
        if (!bankId) {
            return;
        }
        disableControls(true);
        try {
            const payload = buildSessionPayload(bankId);
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            handleNewSession(data);
        } catch (error) {
            console.error('Failed to start session', error);
        } finally {
            disableControls(false);
        }
    });

    revealButton.addEventListener('click', async () => {
        if (!activeSessionCode) {
            return;
        }
        try {
            const response = await fetch('/api/session/reveal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: activeSessionCode })
            });
            const data = await response.json();
            renderState(data);
        } catch (error) {
            console.error('Reveal failed', error);
        }
    });

    nextButton.addEventListener('click', async () => {
        if (!activeSessionCode) {
            return;
        }
        try {
            const response = await fetch('/api/session/next', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: activeSessionCode })
            });
            const data = await response.json();
            if (data.end) {
                questionTextEl.textContent = 'End of question list.';
                questionTextEl.classList.remove('hidden');
                questionImagesEl.innerHTML = '';
                answerReveal.classList.add('hidden');
                revealButton.disabled = true;
                nextButton.disabled = true;
                board.innerHTML = '';
                responsePositions.clear();
                stopPolling();
                if (data.session_code) {
                    activeSessionCode = data.session_code;
                }
            } else {
                renderState(data);
            }
        } catch (error) {
            console.error('Next question failed', error);
        }
    });

    resetButton.addEventListener('click', async () => {
        if (!activeSessionCode) {
            cleanupUi();
            return;
        }
        try {
            await fetch(`/api/session?code=${encodeURIComponent(activeSessionCode)}`, { method: 'DELETE' });
        } catch (error) {
            console.error('Reset failed', error);
        } finally {
            activeSessionCode = null;
            localStorage.removeItem(SESSION_CODE_STORAGE_KEY);
            cleanupUi();
        }
    });

    function disableControls(state) {
        form.querySelector('button').disabled = state;
        bankSelect.disabled = state;
    }

    function startPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        if (!activeSessionCode) {
            return;
        }
        pollTimer = setInterval(async () => {
            try {
                const response = await fetch(`/api/session?view=presenter&code=${encodeURIComponent(activeSessionCode)}`);
                const data = await response.json();
                renderState(data);
            } catch (error) {
                console.error('Polling failed', error);
            }
        }, POLL_INTERVAL);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function renderState(state) {
        if (!state || !state.active) {
            cleanupUi();
            activeSessionCode = null;
            localStorage.removeItem(SESSION_CODE_STORAGE_KEY);
            return;
        }

        if (state.bank_id) {
            if (bankSelect.value !== state.bank_id) {
                bankSelect.value = state.bank_id;
            }
            if (builderState.bankId !== state.bank_id) {
                loadOutline(state.bank_id);
            }
        }

        if (state.session_code) {
            activeSessionCode = state.session_code;
            localStorage.setItem(SESSION_CODE_STORAGE_KEY, activeSessionCode);
        }

        hideSessionBuilder();
        sessionInfo.classList.remove('hidden');
        joinUrlEl.textContent = state.join_url || window.location.origin + '/student';
        if (state.join_url) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(state.join_url)}`;
        } else {
            qrImg.removeAttribute('src');
        }
        sessionCodeEl.textContent = state.session_code || '—';

        updateQuestion(state);
        updateResponses(state.responses || []);

        revealButton.disabled = !!state.revealed;
        nextButton.disabled = state.total_questions && state.current_index >= state.total_questions - 1;
    }

    function updateQuestion(state) {
        const question = state.question;
        if (!question) {
            questionTextEl.textContent = 'Waiting for the next question…';
            questionTextEl.classList.remove('hidden');
            questionImagesEl.innerHTML = '';
            answerReveal.classList.add('hidden');
            return;
        }

        const hasImages = Array.isArray(question.images) && question.images.length > 0;

        if (!hasImages) {
            questionTextEl.textContent = question.text || 'Untitled question';
            questionTextEl.classList.remove('hidden');
        } else {
            questionTextEl.textContent = '';
            questionTextEl.classList.add('hidden');
        }
        questionTopicEl.textContent = question.topic ? `Topic: ${question.topic}` : '';
        questionProgressEl.textContent = state.total_questions
            ? `Question ${state.current_index + 1} / ${state.total_questions}`
            : '';

        renderImages(questionImagesEl, question.images || []);

        const answer = question.answer;
        if (state.revealed && answer && (answer.text || (answer.images && answer.images.length))) {
            answerReveal.classList.remove('hidden');
            answerTextEl.textContent = answer.text || '';
            renderImages(answerImagesEl, answer.images || []);
        } else {
            answerReveal.classList.add('hidden');
            answerTextEl.textContent = '';
            answerImagesEl.innerHTML = '';
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

    function updateResponses(responses) {
        const existingKeys = new Set();
        responses.forEach((response) => {
            const fallbackKey = `${response.name}-${response.answer}-${response.drawing_url || ''}-${response.submitted_at || ''}`;
            const responseId = response.id || fallbackKey;
            existingKeys.add(responseId);
            if (!responsePositions.has(responseId)) {
                responsePositions.set(responseId, randomPosition());
            }

            let card = board.querySelector(`[data-key="${CSS.escape(responseId)}"]`);
            if (!card) {
                card = document.createElement('article');
                card.className = 'response-card';
                card.dataset.key = responseId;
                card.dataset.responseId = responseId;
                const title = document.createElement('h4');
                title.className = 'response-name';
                card.appendChild(title);

                const text = document.createElement('p');
                text.className = 'response-text';
                card.appendChild(text);

                const drawing = document.createElement('img');
                drawing.className = 'response-drawing hidden';
                drawing.alt = 'Student drawing';
                card.appendChild(drawing);

                const dismissButton = document.createElement('button');
                dismissButton.type = 'button';
                dismissButton.className = 'response-dismiss';
                dismissButton.setAttribute('aria-label', 'Remove response');
                dismissButton.innerHTML = '&times;';
                dismissButton.addEventListener('pointerdown', (event) => {
                    event.stopPropagation();
                });
                dismissButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    deleteResponse(responseId, card, dismissButton);
                });
                card.appendChild(dismissButton);

                attachCardInteractions(card);
                board.appendChild(card);
            }
            card.style.zIndex = card.style.zIndex || `${responseZCounter++}`;

            const nameEl = card.querySelector('.response-name');
            const textEl = card.querySelector('.response-text');
            const drawingEl = card.querySelector('.response-drawing');
            const dismissBtn = card.querySelector('.response-dismiss');

            card.dataset.responseId = responseId;
            if (dismissBtn) {
                dismissBtn.disabled = false;
            }

            if (nameEl) {
                nameEl.textContent = response.name || 'Student';
            }
            if (textEl) {
                const answerText = response.answer || '';
                textEl.textContent = answerText;
                textEl.classList.toggle('hidden', !answerText);
            }
            if (drawingEl) {
                if (response.drawing_url) {
                    const handleLoad = () => {
                        adjustDrawingSizing(card, drawingEl);
                        ensureCardWithinBounds(card, responseId);
                    };
                    drawingEl.onload = handleLoad;
                    drawingEl.src = response.drawing_url;
                    drawingEl.dataset.src = response.drawing_url;
                    drawingEl.classList.remove('hidden');
                    if (drawingEl.complete) {
                        handleLoad();
                    }
                } else {
                    drawingEl.removeAttribute('src');
                    drawingEl.removeAttribute('data-src');
                    drawingEl.classList.add('hidden');
                    drawingEl.onload = null;
                    resetDrawingSizing(card, drawingEl);
                }
            }

            const hasDrawing = Boolean(response.drawing_url);
            const hasText = Boolean(response.answer);
            card.classList.toggle('has-drawing', hasDrawing);
            card.classList.toggle('has-text', hasText);
            card.classList.toggle('drawing-only', hasDrawing && !hasText);

            let position = responsePositions.get(responseId);
            let top = 0;
            let left = 0;
            if (position && typeof position.top === 'number' && typeof position.left === 'number') {
                top = position.top;
                left = position.left;
            } else if (position) {
                top = parseFloat(position.top) || 0;
                left = parseFloat(position.left) || 0;
            }

            if (!position || Number.isNaN(top) || Number.isNaN(left)) {
                position = randomPosition();
                top = position.top;
                left = position.left;
                responsePositions.set(responseId, position);
            }

            card.style.top = `${top}px`;
            card.style.left = `${left}px`;
            ensureCardWithinBounds(card, responseId);
        });

        Array.from(board.children).forEach((child) => {
            const key = child.dataset.key;
            if (!existingKeys.has(key)) {
                responsePositions.delete(key);
                board.removeChild(child);
            }
        });
    }

    function getResponseCardDimensions() {
        const styles = getComputedStyle(document.documentElement);
        return {
            width: parseInt(styles.getPropertyValue('--response-card-width'), 10) || 240,
            height: parseInt(styles.getPropertyValue('--response-card-min-height'), 10) || 210,
            imageHeight: parseInt(styles.getPropertyValue('--response-card-image-height'), 10) || 150,
        };
    }

    function adjustDrawingSizing(card, drawingEl) {
        if (!card || !drawingEl) {
            return;
        }
        const naturalWidth = drawingEl.naturalWidth;
        const naturalHeight = drawingEl.naturalHeight;
        if (!naturalWidth || !naturalHeight) {
            resetDrawingSizing(card, drawingEl);
            return;
        }

        const { width: cardWidth, imageHeight: maxImageHeight } = getResponseCardDimensions();
        const maxImageWidth = cardWidth - 30;

        const widthScale = maxImageWidth / naturalWidth;
        const heightScale = maxImageHeight / naturalHeight;
        let scale = Math.min(1, widthScale, heightScale);

        let targetWidth = naturalWidth * scale;
        let targetHeight = naturalHeight * scale;

        const minWidth = maxImageWidth * 0.55;
        if (targetWidth < minWidth) {
            scale = minWidth / targetWidth;
            targetWidth *= scale;
            targetHeight *= scale;
            const clampScale = Math.min(maxImageWidth / targetWidth, maxImageHeight / targetHeight, 1);
            targetWidth *= clampScale;
            targetHeight *= clampScale;
        }

        drawingEl.style.width = `${Math.round(targetWidth)}px`;
        drawingEl.style.height = `${Math.round(targetHeight)}px`;
        card.style.width = `${cardWidth}px`;
        card.style.minHeight = `${Math.max(cardWidth * 0.7, targetHeight + 70)}px`;
    }

    function resetDrawingSizing(card, drawingEl) {
        if (drawingEl) {
            drawingEl.style.removeProperty('width');
            drawingEl.style.removeProperty('height');
            drawingEl.style.removeProperty('max-width');
            drawingEl.style.removeProperty('max-height');
        }
        if (card) {
            card.style.removeProperty('width');
        }
    }

    function randomPosition() {
        const boardWidth = board.clientWidth || 700;
        const boardHeight = board.clientHeight || 520;
        const { width: cardWidth, height: cardHeight } = getResponseCardDimensions();
        const padding = 12;
        const maxLeft = Math.max(padding, boardWidth - cardWidth - padding);
        const maxTop = Math.max(padding, boardHeight - cardHeight - padding);
        const left = padding + Math.random() * (maxLeft - padding);
        const top = padding + Math.random() * (maxTop - padding);
        return { top, left };
    }

    function ensureCardWithinBounds(card, key) {
        const width = board.clientWidth;
        const height = board.clientHeight;
        if (!width || !height) {
            return;
        }
        const padding = 12;
        let top = parseFloat(card.style.top) || 0;
        let left = parseFloat(card.style.left) || 0;
        const maxTop = Math.max(padding, height - card.offsetHeight - padding);
        const maxLeft = Math.max(padding, width - card.offsetWidth - padding);
        top = Math.min(Math.max(top, padding), maxTop);
        left = Math.min(Math.max(left, padding), maxLeft);
        card.style.top = `${top}px`;
        card.style.left = `${left}px`;
        responsePositions.set(key, { top, left });
    }

    function deleteResponse(responseId, card, triggerButton) {
        if (!responseId || !activeSessionCode) {
            return;
        }
        if (card) {
            card.classList.add('response-card-removing');
        }
        const button =
            triggerButton ||
            (card ? card.querySelector('.response-dismiss') : null);
        if (button) {
            button.disabled = true;
        }
        fetch('/api/session/responses', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: activeSessionCode, response_id: responseId }),
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to delete response');
                }
                return response.json();
            })
            .then((data) => {
                if (data && typeof renderState === 'function') {
                    renderState(data);
                }
            })
            .catch((error) => {
                console.error('Unable to delete response', error);
                if (card) {
                    card.classList.remove('response-card-removing');
                }
                if (button) {
                    button.disabled = false;
                }
            });
    }

    function attachCardInteractions(card) {
        if (card.dataset.dragBound === '1') {
            return;
        }
        card.dataset.dragBound = '1';
        card.addEventListener('pointerdown', (event) => {
            const key = card.dataset.key;
            if (!key) {
                return;
            }
            bringCardToFront(card);
            card.setPointerCapture(event.pointerId);
            card.style.cursor = 'grabbing';
            const rect = card.getBoundingClientRect();
            dragState.key = key;
            dragState.offsetX = event.clientX - rect.left;
            dragState.offsetY = event.clientY - rect.top;
        });

        card.addEventListener('pointermove', (event) => {
            if (dragState.key !== card.dataset.key) {
                return;
            }
            event.preventDefault();
            const boardRect = board.getBoundingClientRect();
            const left = event.clientX - boardRect.left - dragState.offsetX;
            const top = event.clientY - boardRect.top - dragState.offsetY;
            card.style.top = `${top}px`;
            card.style.left = `${left}px`;
            ensureCardWithinBounds(card, dragState.key);
        });

        const endDrag = () => {
            if (!dragState.key) {
                return;
            }
            card.style.cursor = 'grab';
            dragState.key = null;
        };

        card.addEventListener('pointerup', endDrag);
        card.addEventListener('pointercancel', endDrag);
        card.addEventListener('lostpointercapture', endDrag);
    }

    function bringCardToFront(card) {
        card.style.zIndex = `${responseZCounter++}`;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function buildSessionPayload(bankId) {
        const payload = { bank_id: bankId };
        if (builderState.bankId !== bankId || !builderState.outline) {
            return payload;
        }
        if (builderState.queue.length) {
            payload.queue = builderState.queue.map((item) => ({ type: item.type, id: item.id }));
            if (builderState.customQuestions.size) {
                const custom = {};
                builderState.customQuestions.forEach((value, key) => {
                    custom[key] = {
                        id: value.id || key,
                        text: value.text || '',
                        answer_text: value.answer_text || '',
                        question_images: Array.isArray(value.question_images) ? value.question_images.slice() : [],
                        answer_images: Array.isArray(value.answer_images) ? value.answer_images.slice() : []
                    };
                });
                payload.custom_questions = custom;
            }
            return payload;
        }

        const allTopics = builderState.outline.topics.map((topic) => topic.topic);
        const selectedTopics = builderState.selectedTopics;
        if (selectedTopics.size === 0 || selectedTopics.size === allTopics.length) {
            return payload;
        }
        payload.topics = Array.from(selectedTopics);
        return payload;
    }

    function getFilteredQuestions() {
        if (!builderState.outline) {
            return [];
        }
        if (builderState.selectedTopics.size === 0) {
            return [];
        }
        const searchTerm = builderState.searchTerm.trim().toLowerCase();
        const filtered = [];
        builderState.outline.topics.forEach((topic) => {
            if (!builderState.selectedTopics.has(topic.topic)) {
                return;
            }
            topic.questions.forEach((question) => {
                if (!question.id) {
                    return;
                }
                const info = builderState.questionLookup.get(question.id);
                if (!info) {
                    return;
                }
                if (searchTerm) {
                    const haystack = info.searchHaystack || createSearchHaystack(info);
                    if (!haystack.includes(searchTerm)) {
                        return;
                    }
                }
                filtered.push(info);
            });
        });
        return filtered;
    }

    function createSearchHaystack(details) {
        if (!details) {
            return '';
        }
        const parts = [];
        if (details.text) {
            parts.push(String(details.text));
        }
        if (details.topic) {
            parts.push(String(details.topic));
        }
        if (Array.isArray(details.tags) && details.tags.length) {
            parts.push(details.tags.join(' '));
        }
        if (details.id) {
            parts.push(String(details.id));
        }
        return parts.join(' ').toLowerCase();
    }

    function queueContainsBankQuestion(questionId) {
        return builderState.queue.some((item) => item.type === 'bank' && item.id === questionId);
    }

    function removeCustomQuestion(id) {
        builderState.customQuestions.delete(id);
    }

    function loadOutline(bankId) {
        return fetch(`/api/bank/${encodeURIComponent(bankId)}/outline`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to fetch outline');
                }
                return response.json();
            })
            .then((data) => {
                const keepExisting = builderState.bankId === bankId && builderState.outline;
                const topicNames = new Set(data.topics.map((topic) => topic.topic));
                const previousTopics = keepExisting ? new Set(builderState.selectedTopics) : null;
                const previousQueue = keepExisting ? builderState.queue.slice() : builderState.queue.filter((item) => item.type === 'custom');

                builderState.bankId = bankId;
                builderState.outline = data;
                builderState.questionLookup = new Map();
                if (!keepExisting) {
                    builderState.searchTerm = '';
                    questionPreviewCache.clear();
                }

                data.topics.forEach((topic) => {
                    topic.questions.forEach((question) => {
                        if (question.id) {
                            builderState.questionLookup.set(question.id, {
                                id: question.id,
                                text: question.text,
                                topic: topic.topic,
                                has_images: question.has_images,
                                tags: question.tags || [],
                                preview_image: question.preview_image || null,
                                searchHaystack: createSearchHaystack({
                                    id: question.id,
                                    text: question.text,
                                    tags: question.tags,
                                    topic: topic.topic
                                })
                            });
                        }
                    });
                });

        if (keepExisting && previousTopics) {
            const restored = [...previousTopics].filter((topic) => topicNames.has(topic));
            builderState.selectedTopics = new Set(restored);
        } else {
            builderState.selectedTopics = new Set();
        }

        if (keepExisting) {
            builderState.queue = previousQueue.filter((item) => {
                if (item.type === 'custom') {
                    return builderState.customQuestions.has(item.id);
                }
                return builderState.questionLookup.has(item.id);
            });
        } else {
            builderState.queue = previousQueue.filter((item) => item.type === 'custom' && builderState.customQuestions.has(item.id));
        }

                renderBuilder();
                showSessionBuilder();
            })
            .catch((error) => {
                console.error('Unable to load bank outline', error);
                hideSessionBuilder();
            });
    }

    function renderBuilder() {
        if (questionSearchInput) {
            questionSearchInput.value = builderState.searchTerm;
            questionSearchInput.disabled = !builderState.outline;
        }
        if (questionSearchClear) {
            questionSearchClear.disabled = !builderState.searchTerm;
        }
        if (!builderState.outline) {
            topicList.innerHTML = '';
            questionList.innerHTML = '';
            selectedList.innerHTML = '';
            builderSummary.textContent = 'No questions queued yet.';
            addAllButton.disabled = true;
            clearSelectionButton.disabled = true;
            syncTemplateControls();
            return;
        }

        renderTopics();
        renderQuestionList();
        renderSelectedQuestions();
        updateBuilderSummary();
        updateBuilderControls();
        syncTemplateControls();
    }

    function renderTopics() {
        topicList.innerHTML = '';
        if (!builderState.outline) {
            return;
        }
        builderState.outline.topics.forEach((topic) => {
            const label = document.createElement('label');
            label.className = 'topic-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = topic.topic;
            checkbox.checked = builderState.selectedTopics.has(topic.topic);
            checkbox.addEventListener('change', (event) => {
                toggleTopic(topic.topic, event.target.checked);
            });

            const text = document.createElement('span');
            text.textContent = `${topic.topic} (${topic.question_count})`;

            label.append(checkbox, text);
            topicList.appendChild(label);
        });
    }

    function renderQuestionList() {
        questionList.innerHTML = '';
        if (!builderState.outline) {
            const info = document.createElement('p');
            info.className = 'empty-state';
            info.textContent = 'Select a question bank to load questions.';
            questionList.appendChild(info);
            return;
        }
        if (builderState.selectedTopics.size === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'Select at least one topic to load questions. Search is limited to chosen topics.';
            questionList.appendChild(empty);
            return;
        }

        const questions = getFilteredQuestions();
        if (!questions.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = builderState.searchTerm.trim()
                ? 'No questions match the current search within the selected topics.'
                : 'No questions found for the selected topics.';
            questionList.appendChild(empty);
            return;
        }

        questions.forEach((question) => {
            const item = document.createElement('article');
            item.className = 'question-item';

            const body = document.createElement('div');
            body.className = 'question-item-body';

            const previewButton = document.createElement('button');
            previewButton.type = 'button';
            previewButton.className = 'question-preview-trigger';
            if (question.preview_image) {
                previewButton.style.backgroundImage = `url(${question.preview_image})`;
            } else {
                previewButton.classList.add('no-image');
                const fallbackLabel = document.createElement('span');
                fallbackLabel.textContent = 'Text only';
                previewButton.appendChild(fallbackLabel);
            }
            const srPreview = document.createElement('span');
            srPreview.className = 'visually-hidden';
            srPreview.textContent = `Preview ${question.text}`;
            previewButton.appendChild(srPreview);
            previewButton.addEventListener('click', () => {
                openQuestionPreview(question.id);
            });

            const content = document.createElement('div');
            content.className = 'question-content';

            const header = document.createElement('header');
            header.textContent = question.text;

            const meta = document.createElement('footer');
            const metaParts = [question.topic];
            if (question.has_images) {
                metaParts.push('includes images');
            }
            if (question.tags && question.tags.length) {
                metaParts.push(question.tags.slice(0, 2).join(', '));
            }
            meta.textContent = metaParts.join(' · ');

            content.append(header, meta);
            body.append(previewButton, content);

            const actions = document.createElement('div');
            actions.className = 'question-actions';
            const addButton = document.createElement('button');
            addButton.type = 'button';
            const alreadySelected = queueContainsBankQuestion(question.id);
            addButton.textContent = alreadySelected ? 'Added' : 'Add to queue';
            addButton.disabled = alreadySelected;
            addButton.addEventListener('click', () => {
                addQuestionToQueue(question.id);
            });
            actions.append(addButton);

            item.append(body, actions);
            questionList.appendChild(item);
        });
    }

    function renderSelectedQuestions() {
        builderState.queue = builderState.queue.filter((entry) => {
            if (entry.type === 'bank') {
                return builderState.questionLookup.has(entry.id);
            }
            return builderState.customQuestions.has(entry.id);
        });
        selectedList.innerHTML = '';
        if (!builderState.queue.length) {
            const empty = document.createElement('li');
            empty.className = 'selection-empty';
            empty.textContent = 'No questions queued. Add from the list on the left.';
            selectedList.appendChild(empty);
            return;
        }

        builderState.queue.forEach((entry, index) => {
            const item = document.createElement('li');

            const title = document.createElement('div');
            const meta = document.createElement('div');
            meta.className = 'selection-meta';

            if (entry.type === 'bank') {
                const info = builderState.questionLookup.get(entry.id);
                if (!info) {
                    return;
                }
                title.textContent = info.text;
                const metaParts = [info.topic];
                if (info.has_images) {
                    metaParts.push('includes images');
                }
                meta.textContent = metaParts.join(' · ');
            } else {
                const custom = builderState.customQuestions.get(entry.id);
                if (!custom) {
                    return;
                }
                title.textContent = custom.text || '(Manual question)';
                const metaParts = ['Manual question'];
                if (custom.question_images && custom.question_images.length) {
                    metaParts.push(`${custom.question_images.length} image${custom.question_images.length === 1 ? '' : 's'}`);
                }
                meta.textContent = metaParts.join(' · ');
            }

            const actions = document.createElement('div');
            actions.className = 'selection-actions';

            const upButton = document.createElement('button');
            upButton.textContent = '↑';
            upButton.disabled = index === 0;
            upButton.addEventListener('click', () => moveQuestion(index, -1));

            const downButton = document.createElement('button');
            downButton.textContent = '↓';
            downButton.disabled = index === builderState.queue.length - 1;
            downButton.addEventListener('click', () => moveQuestion(index, 1));

            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => removeQuestionAt(index));

            actions.append(upButton, downButton, removeButton);
            item.append(title, meta, actions);
            selectedList.appendChild(item);
        });
    }

    function openQuestionPreview(questionId) {
        if (!previewOverlay || !previewBody || !builderState.bankId || !questionId) {
            return;
        }
        previewState.lastFocus = document.activeElement && typeof document.activeElement.focus === 'function'
            ? document.activeElement
            : null;
        previewState.open = true;
        previewState.loading = true;
        previewState.questionId = questionId;
        previewOverlay.classList.remove('hidden');
        previewOverlay.setAttribute('tabindex', '-1');
        if (typeof previewOverlay.focus === 'function') {
            try {
                previewOverlay.focus({ preventScroll: true });
            } catch (error) {
                previewOverlay.focus();
            }
        }
        previewBody.innerHTML = '<p class="preview-loading">Loading question…</p>';
        if (previewTitle) {
            previewTitle.textContent = 'Question preview';
        }

        const cached = questionPreviewCache.get(questionId);
        if (cached) {
            previewState.loading = false;
            renderQuestionPreview(cached);
            focusPreviewClose();
            return;
        }

        fetch(`/api/bank/${encodeURIComponent(builderState.bankId)}/question/${encodeURIComponent(questionId)}`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Failed to load question preview');
                }
                return response.json();
            })
            .then((data) => {
                questionPreviewCache.set(questionId, data);
                if (previewState.questionId === questionId) {
                    previewState.loading = false;
                    renderQuestionPreview(data);
                }
            })
            .catch((error) => {
                console.error('Unable to load question preview', error);
                if (previewState.questionId === questionId && previewBody) {
                    previewState.loading = false;
                    previewBody.innerHTML = '<p class="preview-loading">Unable to load question preview.</p>';
                }
            })
            .finally(() => {
                focusPreviewClose();
            });
    }

    function renderQuestionPreview(data) {
        if (!previewBody) {
            return;
        }
        previewBody.innerHTML = '';

        const fragment = document.createDocumentFragment();
        const questionText = data && (data.text || data.prompt) ? data.text || data.prompt : '';
        const titleText = questionText || 'Question preview';
        if (previewTitle) {
            previewTitle.textContent = titleText;
        }

        if (questionText) {
            const textBlock = document.createElement('div');
            textBlock.className = 'preview-text';
            textBlock.textContent = questionText;
            fragment.appendChild(textBlock);
        }

        const tagValues = [];
        if (data && data.topic) {
            tagValues.push(`Topic: ${data.topic}`);
        }
        if (data && Array.isArray(data.tags)) {
            data.tags.forEach((tag) => {
                if (tag) {
                    tagValues.push(tag);
                }
            });
        }
        if (tagValues.length) {
            const tagWrap = document.createElement('div');
            tagWrap.className = 'preview-tags';
            tagValues.forEach((value) => {
                const badge = document.createElement('span');
                badge.className = 'preview-tag';
                badge.textContent = value;
                tagWrap.appendChild(badge);
            });
            fragment.appendChild(tagWrap);
        }

        if (data && Array.isArray(data.images) && data.images.length) {
            const imageHeading = document.createElement('h4');
            imageHeading.textContent = 'Question images';
            fragment.appendChild(imageHeading);

            const gallery = document.createElement('div');
            gallery.className = 'preview-gallery';
            data.images.forEach((src, index) => {
                if (!src) {
                    return;
                }
                const img = document.createElement('img');
                img.src = src;
                img.alt = `Question image ${index + 1}`;
                gallery.appendChild(img);
            });
            fragment.appendChild(gallery);
        }

        const hasAnswerImages = data && Array.isArray(data.answer_images) && data.answer_images.length;
        if ((data && data.answer_text) || hasAnswerImages) {
            const answerSection = document.createElement('section');
            answerSection.className = 'preview-answer';
            const answerHeading = document.createElement('h4');
            answerHeading.textContent = 'Answer';
            answerSection.appendChild(answerHeading);

            if (data && data.answer_text) {
                const answerText = document.createElement('div');
                answerText.className = 'preview-text';
                answerText.textContent = data.answer_text;
                answerSection.appendChild(answerText);
            }

            if (hasAnswerImages) {
                const answerGallery = document.createElement('div');
                answerGallery.className = 'preview-gallery';
                data.answer_images.forEach((src, index) => {
                    if (!src) {
                        return;
                    }
                    const img = document.createElement('img');
                    img.src = src;
                    img.alt = `Answer image ${index + 1}`;
                    answerGallery.appendChild(img);
                });
                answerSection.appendChild(answerGallery);
            }

            fragment.appendChild(answerSection);
        }

        if (!fragment.hasChildNodes()) {
            const fallback = document.createElement('p');
            fallback.className = 'preview-loading';
            fallback.textContent = 'No preview available for this question.';
            previewBody.appendChild(fallback);
            return;
        }

        previewBody.appendChild(fragment);
    }

    function closeQuestionPreview() {
        if (!previewOverlay) {
            return;
        }
        previewState.open = false;
        previewState.loading = false;
        previewState.questionId = null;
        previewOverlay.classList.add('hidden');
        previewOverlay.removeAttribute('tabindex');
        if (previewState.lastFocus && typeof previewState.lastFocus.focus === 'function') {
            try {
                previewState.lastFocus.focus({ preventScroll: true });
            } catch (error) {
                previewState.lastFocus.focus();
            }
        }
        previewState.lastFocus = null;
    }

    function focusPreviewClose() {
        if (previewOverlay && !previewOverlay.classList.contains('hidden') && previewClose) {
            try {
                previewClose.focus({ preventScroll: true });
            } catch (error) {
                previewClose.focus();
            }
        }
    }

    function updateBuilderSummary() {
        if (!builderState.outline) {
            builderSummary.textContent = 'Select a question bank to begin building a session.';
            return;
        }
        const totalTopicsAvailable = builderState.outline.topics.length;
        const selectedTopicCount = builderState.selectedTopics.size;
        const queued = builderState.queue.length;
        const topicSummary = `Topics selected: ${selectedTopicCount} of ${totalTopicsAvailable}`;
        if (queued === 0) {
            builderSummary.textContent = topicSummary;
        } else {
            builderSummary.textContent = `${queued} queued question${queued === 1 ? '' : 's'} · ${topicSummary}`;
        }
    }

    function updateBuilderControls() {
        const filtered = getFilteredQuestions();
        const hasSelectable = filtered.some((question) => !queueContainsBankQuestion(question.id));
        addAllButton.disabled = !builderState.outline || builderState.selectedTopics.size === 0 || !hasSelectable;
        clearSelectionButton.disabled = builderState.queue.length === 0;
        toggleTopicsButton.disabled = !builderState.outline || !builderState.outline.topics.length;
        if (builderState.outline) {
            const totalTopics = builderState.outline.topics.length;
            const selectedCount = builderState.selectedTopics.size;
            const allSelected = selectedCount === totalTopics;
            const noneSelected = selectedCount === 0;
            toggleTopicsButton.textContent = noneSelected ? 'Select all' : allSelected ? 'Clear all' : 'Toggle all';
        } else {
            toggleTopicsButton.textContent = 'Toggle all';
        }
    }

    function setTemplateBusy(state) {
        templateState.busy = Boolean(state);
        if (templateControls) {
            templateControls.classList.toggle('is-busy', templateState.busy);
        }
        syncTemplateControls();
    }

    function syncTemplateControls() {
        if (templateNameInput) {
            templateNameInput.disabled = templateState.busy;
        }
        if (templateSaveButton) {
            const canSave = !templateState.busy && builderState.bankId && builderState.queue.length > 0;
            templateSaveButton.disabled = !canSave;
        }
        if (templateSelect) {
            templateSelect.disabled = templateState.busy;
        }
        updateTemplateActionState();
    }

    function updateTemplateActionState() {
        const hasSelection = Boolean(templateSelect && templateSelect.value);
        if (templateLoadButton) {
            templateLoadButton.disabled = templateState.busy || !hasSelection;
        }
        if (templateDeleteButton) {
            templateDeleteButton.disabled = templateState.busy || !hasSelection;
        }
    }

    function setTemplateFeedbackMessage(message, tone = 'info') {
        if (!templateFeedback) {
            return;
        }
        if (!message) {
            templateFeedback.textContent = '';
            templateFeedback.classList.add('hidden');
            templateFeedback.removeAttribute('data-tone');
            return;
        }
        templateFeedback.textContent = message;
        templateFeedback.dataset.tone = tone;
        templateFeedback.classList.remove('hidden');
    }

    function templateOptionLabel(template) {
        const parts = [];
        const name = template && template.name ? template.name : 'Template';
        parts.push(name);
        if (template && template.bank_id) {
            const bankLabel = bankLabelMap.get(template.bank_id) || template.bank_id;
            if (bankLabel) {
                parts.push(bankLabel);
            }
        }
        const questionCount =
            typeof template.question_count === 'number'
                ? template.question_count
                : Array.isArray(template.queue)
                    ? template.queue.length
                    : 0;
        if (questionCount) {
            parts.push(`${questionCount} question${questionCount === 1 ? '' : 's'}`);
        }
        return parts.join(' · ');
    }

    function renderTemplateOptions(preselectId) {
        if (!templateSelect) {
            return;
        }
        const previous = typeof preselectId === 'string' ? preselectId : templateSelect.value;
        templateSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = templateState.templates.length ? 'Select a template…' : 'No templates saved yet';
        templateSelect.appendChild(placeholder);

        templateState.templates.forEach((template) => {
            if (!template || !template.id) {
                return;
            }
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = templateOptionLabel(template);
            templateSelect.appendChild(option);
        });

        if (previous && templateSelect.querySelector(`option[value="${CSS.escape(previous)}"]`)) {
            templateSelect.value = previous;
        } else {
            templateSelect.value = '';
        }
        updateTemplateActionState();
    }

    async function refreshTemplates(preselectId, { silent = false } = {}) {
        if (!templateSelect) {
            return;
        }
        try {
            const response = await fetch('/api/templates');
            if (!response.ok) {
                const message = await extractErrorMessage(response, 'Unable to load templates.');
                throw new Error(message);
            }
            const data = await response.json();
            templateState.templates = Array.isArray(data.templates) ? data.templates : [];
            renderTemplateOptions(preselectId);
            if (!silent) {
                setTemplateFeedbackMessage('');
            }
        } catch (error) {
            console.error('Unable to load templates', error);
            templateState.templates = [];
            renderTemplateOptions();
            if (!silent) {
                setTemplateFeedbackMessage(error.message || 'Unable to load templates.', 'error');
            }
        }
    }

    function findTemplate(templateId) {
        return templateState.templates.find((template) => template && template.id === templateId) || null;
    }

    function cloneTemplateValue(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function createTemplatePayload(name) {
        const queue = builderState.queue.map((entry) => ({ type: entry.type, id: entry.id }));
        const custom = {};
        builderState.customQuestions.forEach((value, key) => {
            const cloned = cloneTemplateValue(value) || {};
            if (cloned && typeof cloned === 'object' && !cloned.id) {
                cloned.id = key;
            }
            custom[key] = cloned;
        });
        const bankId = builderState.bankId || (bankSelect ? bankSelect.value : null);
        return {
            name,
            bank_id: bankId,
            queue,
            custom_questions: custom,
            topics: Array.from(builderState.selectedTopics),
        };
    }

    async function applyTemplate(templateId) {
        const template = findTemplate(templateId);
        if (!template) {
            setTemplateFeedbackMessage('Selected template was not found.', 'error');
            return;
        }

        setTemplateBusy(true);
        setTemplateFeedbackMessage('');
        try {
            if (bankSelect && bankSelect.value !== template.bank_id) {
                bankSelect.value = template.bank_id;
            }
            if (builderState.bankId !== template.bank_id || !builderState.outline) {
                await loadOutline(template.bank_id);
            }
            if (!builderState.outline) {
                throw new Error('Question bank outline is unavailable.');
            }

            const topicNames = new Set(builderState.outline.topics.map((topic) => topic.topic));
            const templateTopics = Array.isArray(template.topics)
                ? template.topics.filter((topic) => topicNames.has(topic))
                : [];
            builderState.selectedTopics = new Set(templateTopics);

            builderState.customQuestions = new Map();
            const custom = template.custom_questions && typeof template.custom_questions === 'object' ? template.custom_questions : {};
            Object.entries(custom).forEach(([key, value]) => {
                if (!value) {
                    return;
                }
                const cloned = cloneTemplateValue(value);
                if (cloned && typeof cloned === 'object') {
                    if (!cloned.id) {
                        cloned.id = key;
                    }
                    builderState.customQuestions.set(key, cloned);
                }
            });

            builderState.queue = [];
            const entries = Array.isArray(template.queue) ? template.queue : [];
            entries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const entryId = entry.id;
                if (entry.type === 'custom' && builderState.customQuestions.has(entryId)) {
                    builderState.queue.push({ type: 'custom', id: entryId });
                } else if (entry.type === 'bank' && builderState.questionLookup.has(entryId)) {
                    builderState.queue.push({ type: 'bank', id: entryId });
                }
            });

            renderBuilder();

            const missingCount = entries.length - builderState.queue.length;
            if (missingCount > 0) {
                setTemplateFeedbackMessage(
                    `Template loaded with ${missingCount} unavailable question${missingCount === 1 ? '' : 's'} removed.`,
                    'warning'
                );
            } else if (builderState.queue.length > 0) {
                setTemplateFeedbackMessage('Template loaded.', 'success');
            } else {
                setTemplateFeedbackMessage('Template loaded, but no questions were available.', 'warning');
            }
        } catch (error) {
            console.error('Unable to apply template', error);
            setTemplateFeedbackMessage(error.message || 'Unable to load template.', 'error');
        } finally {
            setTemplateBusy(false);
        }
    }

    async function extractErrorMessage(response, fallback) {
        const text = await response.text();
        if (!text) {
            return fallback;
        }
        try {
            const data = JSON.parse(text);
            if (data && typeof data === 'object') {
                return data.description || data.error || fallback;
            }
        } catch (error) {
            // ignore parse errors
        }
        return text;
    }

    function toggleTopic(topic, isChecked) {
        if (isChecked) {
            builderState.selectedTopics.add(topic);
        } else {
            builderState.selectedTopics.delete(topic);
        }
        renderBuilder();
    }

    function toggleAllTopics() {
        if (!builderState.outline) {
            return;
        }
        const totalTopics = builderState.outline.topics.length;
        const selectedCount = builderState.selectedTopics.size;
        const selectAll = selectedCount < totalTopics;
        if (selectAll) {
            builderState.selectedTopics = new Set(
                builderState.outline.topics.map((topic) => topic.topic)
            );
        } else {
            builderState.selectedTopics.clear();
        }
        renderBuilder();
    }

    function addQuestionToQueue(questionId) {
        if (!questionId || queueContainsBankQuestion(questionId)) {
            return;
        }
        builderState.queue.push({ type: 'bank', id: questionId });
        renderBuilder();
    }

    function addFilteredQuestionsToQueue() {
        const filtered = getFilteredQuestions();
        filtered.forEach((question) => {
            if (question.id && !queueContainsBankQuestion(question.id)) {
                builderState.queue.push({ type: 'bank', id: question.id });
            }
        });
        renderBuilder();
    }

    function moveQuestion(index, delta) {
        const target = index + delta;
        if (target < 0 || target >= builderState.queue.length) {
            return;
        }
        const [item] = builderState.queue.splice(index, 1);
        builderState.queue.splice(target, 0, item);
        renderBuilder();
    }

    function removeQuestionAt(index) {
        const removed = builderState.queue.splice(index, 1);
        if (removed.length && removed[0].type === 'custom') {
            removeCustomQuestion(removed[0].id);
        }
        renderBuilder();
    }

    function showSessionBuilder() {
        sessionBuilder.classList.remove('hidden');
    }

    function hideSessionBuilder() {
        sessionBuilder.classList.add('hidden');
    }

    function resetBuilderState() {
        builderState.bankId = null;
        builderState.outline = null;
        builderState.selectedTopics = new Set();
        builderState.questionLookup = new Map();
        builderState.queue = [];
        builderState.customQuestions = new Map();
        builderState.searchTerm = '';
        topicList.innerHTML = '';
        questionList.innerHTML = '';
        selectedList.innerHTML = '';
        builderSummary.textContent = 'No questions queued yet.';
        addAllButton.disabled = true;
        clearSelectionButton.disabled = true;
        if (questionSearchInput) {
            questionSearchInput.value = '';
            questionSearchInput.disabled = true;
        }
        if (questionSearchClear) {
            questionSearchClear.disabled = true;
        }
        resetManualForm();
        manualState.open = false;
        renderManualPanel();
    }

    async function bootstrap() {
        await refreshTemplates(undefined, { silent: true });
        syncTemplateControls();
        const storedCode = localStorage.getItem(SESSION_CODE_STORAGE_KEY);
        if (!storedCode) {
            return;
        }
        activeSessionCode = storedCode;
        try {
            const response = await fetch(`/api/session?view=presenter&code=${encodeURIComponent(activeSessionCode)}`);
            if (!response.ok) {
                throw new Error('Session not found');
            }
            const data = await response.json();
            renderState(data);
            startPolling();
        } catch (error) {
            console.warn('Could not restore session', error);
            activeSessionCode = null;
            localStorage.removeItem(SESSION_CODE_STORAGE_KEY);
        }
    }

    function handleNewSession(data) {
        if (!data || !data.session_code) {
            renderState(data);
            return;
        }
        activeSessionCode = data.session_code;
        localStorage.setItem(SESSION_CODE_STORAGE_KEY, activeSessionCode);
        renderState(data);
        startPolling();
        hideSessionBuilder();
    }

    function cleanupUi() {
        stopPolling();
        sessionInfo.classList.add('hidden');
        questionTextEl.textContent = 'Start a session to display questions.';
        questionTextEl.classList.remove('hidden');
        questionImagesEl.innerHTML = '';
        answerReveal.classList.add('hidden');
        board.innerHTML = '';
        responsePositions.clear();
        revealButton.disabled = true;
        nextButton.disabled = true;
        joinUrlEl.textContent = '—';
        sessionCodeEl.textContent = '—';
        qrImg.removeAttribute('src');
        if (builderState.outline) {
            renderBuilder();
            showSessionBuilder();
        }
    }

    function toggleTimer() {
        if (timerRunning) {
            pauseTimer();
            return;
        }
        if (timerRemaining <= 0) {
            timerRemaining = getTimerInputSeconds();
        }
        if (timerRemaining <= 0) {
            flashTimerPanel();
            return;
        }
        startTimer();
    }

    function startTimer() {
        timerTarget = Date.now() + timerRemaining * 1000;
        timerRunning = true;
        timerPanel?.classList.remove('timer-finished');
        timerPanel?.classList.add('timer-running');
        timerStartButton.textContent = 'Pause';
        if (timerInterval) {
            window.clearInterval(timerInterval);
        }
        timerInterval = window.setInterval(() => {
            const remaining = Math.max(0, Math.round((timerTarget - Date.now()) / 1000));
            if (remaining !== timerRemaining) {
                timerRemaining = remaining;
                updateTimerDisplay();
            }
            if (timerRemaining <= 0) {
                finishTimer();
            }
        }, 250);
    }

    function pauseTimer() {
        if (timerInterval) {
            window.clearInterval(timerInterval);
            timerInterval = null;
        }
        if (timerTarget) {
            timerRemaining = Math.max(0, Math.round((timerTarget - Date.now()) / 1000));
        }
        timerRunning = false;
        timerTarget = null;
        timerPanel?.classList.remove('timer-running');
        timerStartButton.textContent = timerRemaining > 0 ? 'Resume' : 'Start';
        updateTimerDisplay();
    }

    function finishTimer() {
        pauseTimer();
        timerRemaining = 0;
        updateTimerDisplay();
        timerPanel?.classList.add('timer-finished');
        timerStartButton.textContent = 'Start';
    }

    function resetTimer() {
        pauseTimer();
        timerRemaining = 0;
        timerPanel?.classList.remove('timer-running', 'timer-finished');
        timerStartButton.textContent = 'Start';
        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        const total = timerRemaining > 0 ? timerRemaining : getTimerInputSeconds();
        const mins = Math.floor(total / 60)
            .toString()
            .padStart(2, '0');
        const secs = (total % 60)
            .toString()
            .padStart(2, '0');
        if (timerDisplay) {
            timerDisplay.textContent = `${mins}:${secs}`;
        }
    }

    function getTimerInputSeconds() {
        const mins = clampNumber(parseInt(timerMinutesInput?.value, 10), 0, 99) || 0;
        const secs = clampNumber(parseInt(timerSecondsInput?.value, 10), 0, 59) || 0;
        return mins * 60 + secs;
    }

    function flashTimerPanel() {
        if (!timerPanel) {
            return;
        }
        timerPanel.classList.add('timer-finished');
        window.setTimeout(() => {
            timerPanel.classList.remove('timer-finished');
        }, 1200);
    }

    function clampNumber(value, min, max) {
        if (!Number.isFinite(value)) {
            return undefined;
        }
        return Math.min(Math.max(value, min), max);
    }

    syncTemplateControls();
    bootstrap();
})();
