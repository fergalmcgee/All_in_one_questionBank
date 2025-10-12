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

    const POLL_INTERVAL = 2500;
    const SESSION_CODE_STORAGE_KEY = 'qrt_active_session_code';
    const responsePositions = new Map();
    let pollTimer = null;
    let activeSessionCode = null;

    const builderState = {
        bankId: null,
        outline: null,
        selectedTopics: new Set(),
        questionLookup: new Map(),
        queue: [],
        customQuestions: new Map()
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

    if (logoutForm) {
        logoutForm.addEventListener('submit', () => {
            localStorage.removeItem(SESSION_CODE_STORAGE_KEY);
            activeSessionCode = null;
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
        zone.addEventListener('click', () => input.click());
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
            const key = `${response.name}-${response.answer}-${response.submitted_at || ''}`;
            existingKeys.add(key);
            if (!responsePositions.has(key)) {
                responsePositions.set(key, randomPosition());
            }

            let card = board.querySelector(`[data-key="${CSS.escape(key)}"]`);
            if (!card) {
                card = document.createElement('article');
                card.className = 'response-card';
                card.dataset.key = key;
                card.innerHTML = `
                    <h4>${escapeHtml(response.name || 'Student')}</h4>
                    <p>${escapeHtml(response.answer || '')}</p>
                `;
                board.appendChild(card);
            }

            let position = responsePositions.get(key);
            if (!position || typeof position.top !== 'number' || typeof position.left !== 'number') {
                position = { top: parseFloat(position?.top) || 10, left: parseFloat(position?.left) || 10 };
                responsePositions.set(key, position);
            }
            card.style.top = `${position.top}%`;
            card.style.left = `${position.left}%`;
        });

        Array.from(board.children).forEach((child) => {
            const key = child.dataset.key;
            if (!existingKeys.has(key)) {
                responsePositions.delete(key);
                board.removeChild(child);
            }
        });
    }

    function randomPosition() {
        const existing = Array.from(responsePositions.values());
        let attempt = 0;
        while (attempt < 25) {
            const top = 5 + Math.random() * 85;
            const left = 5 + Math.random() * 85;
            const tooClose = existing.some((pos) => {
                const posTop = typeof pos.top === 'number' ? pos.top : parseFloat(pos.top);
                const posLeft = typeof pos.left === 'number' ? pos.left : parseFloat(pos.left);
                if (Number.isNaN(posTop) || Number.isNaN(posLeft)) {
                    return false;
                }
                return Math.abs(posTop - top) < 12 && Math.abs(posLeft - left) < 16;
            });
            if (!tooClose) {
                return { top, left };
            }
            attempt += 1;
        }
        return {
            top: 10 + Math.random() * 80,
            left: 10 + Math.random() * 80
        };
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
        const treatAsAll = builderState.selectedTopics.size === 0;
        const filtered = [];
        builderState.outline.topics.forEach((topic) => {
            if (!treatAsAll && !builderState.selectedTopics.has(topic.topic)) {
                return;
            }
            topic.questions.forEach((question) => {
                filtered.push({
                    id: question.id,
                    text: question.text,
                    has_images: question.has_images,
                    tags: question.tags || [],
                    topic: topic.topic,
                });
            });
        });
        return filtered;
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

                data.topics.forEach((topic) => {
                    topic.questions.forEach((question) => {
                        if (question.id) {
                            builderState.questionLookup.set(question.id, {
                                id: question.id,
                                text: question.text,
                                topic: topic.topic,
                                has_images: question.has_images,
                                tags: question.tags || [],
                            });
                        }
                    });
                });

                if (keepExisting && previousTopics) {
                    const restored = [...previousTopics].filter((topic) => topicNames.has(topic));
                    builderState.selectedTopics = new Set(restored.length ? restored : topicNames);
                } else {
                    builderState.selectedTopics = new Set(topicNames);
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
        if (!builderState.outline) {
            topicList.innerHTML = '';
            questionList.innerHTML = '';
            selectedList.innerHTML = '';
            builderSummary.textContent = 'No questions queued yet.';
            addAllButton.disabled = true;
            clearSelectionButton.disabled = true;
            return;
        }

        renderTopics();
        renderQuestionList();
        renderSelectedQuestions();
        updateBuilderSummary();
        updateBuilderControls();
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

        const questions = getFilteredQuestions();
        if (!questions.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'No questions match the current topic filters.';
            questionList.appendChild(empty);
            return;
        }

        questions.forEach((question) => {
            if (!question.id) {
                return;
            }
            const item = document.createElement('article');
            item.className = 'question-item';

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

            const button = document.createElement('button');
            const alreadySelected = queueContainsBankQuestion(question.id);
            button.textContent = alreadySelected ? 'Added' : 'Add to queue';
            button.disabled = alreadySelected;
            button.addEventListener('click', () => {
                addQuestionToQueue(question.id);
            });

            item.append(header, meta, button);
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

    function updateBuilderSummary() {
        if (!builderState.outline) {
            builderSummary.textContent = 'Select a question bank to begin building a session.';
            return;
        }
        const totalTopicsAvailable = builderState.outline.topics.length;
        const topicCount = builderState.selectedTopics.size || totalTopicsAvailable;
        const queued = builderState.queue.length;
        if (queued === 0) {
            builderSummary.textContent = `Topics selected: ${topicCount} of ${totalTopicsAvailable}`;
        } else {
            builderSummary.textContent = `${queued} queued question${queued === 1 ? '' : 's'} · Topics selected: ${topicCount}`;
        }
    }

    function updateBuilderControls() {
        const filtered = getFilteredQuestions();
        const hasSelectable = filtered.some((question) => !queueContainsBankQuestion(question.id));
        addAllButton.disabled = !builderState.outline || !hasSelectable;
        clearSelectionButton.disabled = builderState.queue.length === 0;
        toggleTopicsButton.disabled = !builderState.outline;
        if (builderState.outline) {
            const totalTopics = builderState.outline.topics.length;
            const selectedCount = builderState.selectedTopics.size;
            const allSelected = selectedCount === totalTopics;
            const noneSelected = selectedCount === 0;
            toggleTopicsButton.textContent = allSelected ? 'Uncheck all' : noneSelected ? 'Check all' : 'Toggle all';
        } else {
            toggleTopicsButton.textContent = 'Toggle all';
        }
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
        topicList.innerHTML = '';
        questionList.innerHTML = '';
        selectedList.innerHTML = '';
        builderSummary.textContent = 'No questions queued yet.';
        addAllButton.disabled = true;
        clearSelectionButton.disabled = true;
        resetManualForm();
        manualState.open = false;
        renderManualPanel();
    }

    async function bootstrap() {
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

    bootstrap();
})();
