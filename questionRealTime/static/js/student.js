(function () {
    const statusMessage = document.getElementById('status-message');
    const joinSection = document.getElementById('join-section');
    const joinForm = document.getElementById('join-form');
    const nameInput = document.getElementById('student-name');
    const questionSection = document.getElementById('question-section');
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

    const POLL_INTERVAL = 4000;
    const NAME_STORAGE_KEY = 'qrt_student_name';
    const SESSION_CODE_STORAGE_KEY = 'qrt_student_code';

    let pollTimer = null;
    let joined = false;
    let currentQuestionId = null;
    let respondedThisQuestion = false;
    let activeSessionCode = null;

    const savedName = localStorage.getItem(NAME_STORAGE_KEY);
    if (savedName) {
        nameInput.value = savedName;
    }

    const params = new URLSearchParams(window.location.search);
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
        const name = nameInput.value.trim();
        if (!code) {
            sessionCodeInput.focus();
            return;
        }
        if (!name) {
            nameInput.focus();
            return;
        }
        joined = true;
        activeSessionCode = code;
        localStorage.setItem(NAME_STORAGE_KEY, name);
        if (!sessionCodeInput.readOnly) {
            localStorage.setItem(SESSION_CODE_STORAGE_KEY, code);
        }
        joinSection.classList.add('hidden');
        questionSection.classList.remove('hidden');
        statusMessage.textContent = 'You are in! Waiting for the next question.';
        fetchState();
        startPolling();
    });

    answerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!joined || respondedThisQuestion || !activeSessionCode) {
            return;
        }
        const answer = answerInput.value.trim();
        const name = nameInput.value.trim();
        if (!answer || !name) {
            return;
        }

        setFormDisabled(true);
        try {
            const response = await fetch('/api/session/responses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, answer, code: activeSessionCode })
            });
            if (!response.ok) {
                throw new Error('Failed to send answer');
            }
            respondedThisQuestion = true;
            answerFeedback.textContent = 'Answer received!';
        } catch (error) {
            console.error(error);
            answerFeedback.textContent = 'Could not send answer. Try again.';
            setFormDisabled(false);
        }
    });

    function setFormDisabled(state) {
        answerInput.disabled = state;
        answerForm.querySelector('button').disabled = state;
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
            return;
        }

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
    }

    fetchState();
})();
