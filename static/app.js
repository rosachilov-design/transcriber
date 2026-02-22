let wavesurfer;
let currentTaskId = null;
let statusInterval = null;
let segments = [];
let lastSegmentCount = 0;

// DOM Elements
const launchScreen = document.getElementById('launch-screen');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const mainInterface = document.getElementById('main-interface');
const filenameDisplay = document.getElementById('filename-display');
const progressBar = document.getElementById('progress-bar');
const statusText = document.getElementById('status-text');
const percentText = document.getElementById('percent-text');
const playPauseBtn = document.getElementById('play-pause');
const playIcon = document.getElementById('play-icon');
const transcriptionContent = document.getElementById('transcription-content');
const footerActions = document.getElementById('footer-actions');
const mdFilenameSpan = document.getElementById('md-filename-span');
const docxFilenameSpan = document.getElementById('docx-filename-span');
const removeFileBtn = document.getElementById('remove-file');
const currentTimeDisplay = document.getElementById('current-time');
const durationDisplay = document.getElementById('duration');
const progressSection = document.getElementById('progress-section');
const localLogConsole = document.getElementById('local-log-console');
const startDiarizeBtn = document.getElementById('start-diarize-btn');
const startTranscribeBtn = document.getElementById('start-transcribe-btn');

let lastStatus = null;

// ─── Dropzone & File Input ───

// Drag events on the entire launch screen
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
});

document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dropzone.classList.remove('dragging');
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

// Click on card opens file browser
dropzone.addEventListener('click', (e) => {
    // Don't trigger if clicking a button
    if (e.target.closest('button')) return;
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

function initWaveSurfer(url) {
    if (wavesurfer) wavesurfer.destroy();

    // Create a real <audio> element for streaming playback (no full decode)
    const audioEl = document.createElement('audio');
    audioEl.crossOrigin = 'anonymous';
    audioEl.preload = 'metadata';
    audioEl.src = url;

    // Wait for metadata so we know the real duration before creating WaveSurfer
    audioEl.addEventListener('loadedmetadata', () => {
        const realDuration = audioEl.duration;
        durationDisplay.textContent = formatTime(realDuration);

        // Generate randomized peaks that look like a real waveform
        const numPeaks = Math.max(500, Math.floor(realDuration * 10));
        const fakePeaks = new Float32Array(numPeaks);
        let val = 0.3;
        for (let i = 0; i < numPeaks; i++) {
            val += (Math.random() - 0.5) * 0.15;
            val = Math.max(0.05, Math.min(0.95, val));
            fakePeaks[i] = val;
        }

        wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: '#475569',
            progressColor: '#f97316',
            cursorColor: '#f97316',
            barWidth: 3,
            barGap: 3,
            barRadius: 4,
            height: 180,
            normalize: false,
            media: audioEl,
            peaks: [fakePeaks],
            duration: realDuration
        });

        wavesurfer.on('audioprocess', (time) => {
            currentTimeDisplay.textContent = formatTime(time);
            highlightTranscription(time);
        });

        wavesurfer.on('interaction', () => {
            const time = wavesurfer.getCurrentTime();
            currentTimeDisplay.textContent = formatTime(time);
            highlightTranscription(time);
        });

        wavesurfer.on('play', () => { playIcon.className = 'pause-icon'; });
        wavesurfer.on('pause', () => { playIcon.className = 'play-icon'; });
    });

    audioEl.addEventListener('error', (e) => {
        console.error('Audio element error:', e);
        addLog('⚠️ Audio player failed to load. Playback may not work.', 'error');
    });
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function addLog(message, type = 'info') {
    if (!localLogConsole) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.textContent = `[${time}] ${message}`;
    localLogConsole.appendChild(line);
    localLogConsole.scrollTop = localLogConsole.scrollHeight;
}

let knownSpeakers = [];

async function handleFile(file) {
    console.log("Handling file:", file.name);
    // UI Transition
    filenameDisplay.textContent = file.name;
    launchScreen.classList.add('hidden');
    mainInterface.classList.remove('hidden');

    knownSpeakers = [];
    renderSpeakerList();
    transcriptionContent.innerHTML = '<div class="placeholder-text">Uploading to server...</div>';

    // Do NOT init WaveSurfer here — wait until upload completes to use server URL

    // Initial log state
    progressSection.classList.remove('hidden');
    statusText.textContent = '☁️ Uploading audio...';
    percentText.textContent = '';
    progressBar.style.width = '0%';
    localLogConsole.innerHTML = '<div class="log-line info">🚀 Session initialized...</div>';
    addLog(`📂 Preparing ${file.name}...`, 'info');

    // Hide action buttons initially
    if (startDiarizeBtn) startDiarizeBtn.classList.add('hidden');
    if (startTranscribeBtn) startTranscribeBtn.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', file);

    try {
        addLog('📤 Uploading to local server...', 'info');
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.task_id) {
            currentTaskId = data.task_id;
            addLog(`✅ Upload complete (ID: ${currentTaskId})`, 'success');

            // Re-sync WaveSurfer to the server-side file instead of blob for better range support
            const serverUrl = `/audio/${encodeURIComponent(currentTaskId)}`;
            initWaveSurfer(serverUrl);

            if (data.status === 'completed') {
                addLog('✨ Auto-detected existing transcription!', 'success');
                // We need to fetch the status once to get the result data
                const statusRes = await fetch(`/status/${currentTaskId}`);
                const statusData = await statusRes.json();
                updateUI(statusData);
            } else if (data.status === 'diarization_complete') {
                addLog('✨ Auto-detected existing diarization!', 'success');
                startPolling();
            } else {
                addLog('Await user action to start diarization.', 'muted');
                startPolling();
            }
        } else {
            throw new Error("No task_id returned from server");
        }
    } catch (err) {
        console.error('Upload failed:', err);
        statusText.textContent = '❌ Upload failed';
        addLog(`❌ Fatal: ${err.message}`, 'error');
    }
}


// ─── Load Completed Transcription ───

function loadCompletedTranscription(data) {
    progressSection.classList.add('hidden');
    statusText.textContent = '✅ Transcription loaded';
    addLog('✨ Processing complete!', 'success');

    transcriptionContent.innerHTML = '';
    segments = data.result;
    lastSegmentCount = 0;

    data.result.forEach((seg, idx) => {
        const div = createSegmentEl(seg, idx);
        transcriptionContent.appendChild(div);
    });
    lastSegmentCount = data.result.length;

    // Show download buttons
    if (data.md_path) mdFilenameSpan.textContent = data.md_path;
    if (data.docx_path) docxFilenameSpan.textContent = data.docx_path;
    footerActions.classList.remove('hidden');

    // Collect unique speakers from the transcription
    const speakerSet = new Set(data.result.map(s => s.speaker));
    knownSpeakers = [...speakerSet];
    renderSpeakerList();
    refreshAllSegments();
}


// ─── Polling ───

function startPolling() {
    if (statusInterval) clearInterval(statusInterval);
    lastSegmentCount = 0;
    lastStatus = null;

    statusInterval = setInterval(async () => {
        if (!currentTaskId) return;

        try {
            const response = await fetch(`/status/${currentTaskId}`);
            const data = await response.json();

            updateUI(data);

            if (data.status === 'completed' || data.status === 'not_found' || data.status === 'error') {
                clearInterval(statusInterval);
            }
        } catch (err) {
            console.error('Status check failed:', err);
        }
    }, 2000);
}


// ─── Phase Actions ───

if (startDiarizeBtn) {
    startDiarizeBtn.onclick = async () => {
        if (!currentTaskId) return;
        startDiarizeBtn.disabled = true;
        addLog('▶️ Triggering Diarization phase...', 'info');
        try {
            const response = await fetch(`/diarize/${currentTaskId}`, { method: 'POST' });
            if (!response.ok) throw new Error("Server error starting diarization");
        } catch (err) {
            addLog(`❌ Error triggering diarization: ${err.message}`, 'error');
            startDiarizeBtn.disabled = false;
        }
    };
}

if (startTranscribeBtn) {
    startTranscribeBtn.onclick = async () => {
        if (!currentTaskId) return;
        startTranscribeBtn.disabled = true;
        addLog('▶️ Triggering Transcription phase...', 'info');
        try {
            const response = await fetch(`/transcribe/${currentTaskId}`, { method: 'POST' });
            if (!response.ok) throw new Error("Server error starting transcription");
        } catch (err) {
            addLog(`❌ Error triggering transcription: ${err.message}`, 'error');
            startTranscribeBtn.disabled = false;
        }
    };
}


// ─── UI Updates ───

function updateUI(data) {
    if (data.status === 'uploaded') {
        progressSection.classList.remove('hidden');
        statusText.textContent = `File ready.`;
        percentText.textContent = ``;
        progressBar.style.width = `0%`;
        if (startDiarizeBtn) {
            startDiarizeBtn.classList.remove('hidden');
            startDiarizeBtn.disabled = false;
        }
        if (startTranscribeBtn) startTranscribeBtn.classList.add('hidden');
    }
    else if (data.status === 'diarization_complete') {
        progressSection.classList.remove('hidden');
        statusText.textContent = `Diarization complete.`;
        percentText.textContent = `100%`;
        progressBar.style.width = `100%`;

        if (startDiarizeBtn) startDiarizeBtn.classList.add('hidden');
        if (startTranscribeBtn) {
            startTranscribeBtn.classList.remove('hidden');
            startTranscribeBtn.disabled = false;
        }
    }
    else if (data.status === 'pending' || data.status === 'diarizing' || data.status === 'transcribing' || data.status === 'aligning') {
        progressSection.classList.remove('hidden');
        let stateStr = "Processing";
        if (data.status === 'diarizing') stateStr = "Diarizing audio (Pyannote)";
        if (data.status === 'transcribing') stateStr = "Transcribing (Whisper)";
        if (data.status === 'aligning') stateStr = "Aligning speakers";
        statusText.textContent = `⚡ ${stateStr}...`;
        percentText.textContent = `${data.progress || 0}%`;
        progressBar.style.width = `${data.progress || 0}%`;
    }
    else if (data.status === 'completed') {
        loadCompletedTranscription(data);
        clearInterval(statusInterval);
    }
    else if (data.status === 'error') {
        progressSection.classList.remove('hidden');
        statusText.textContent = `❌ Error: ${data.error || 'Unknown'}`;
        percentText.textContent = '';
        progressBar.style.width = '0%';
        addLog(`❌ Engine Error: ${data.error}`, 'error');
        transcriptionContent.innerHTML = `<div class="error-text">Engine error. Check console and retry.</div>`;
    }

    // Status change logging
    if (data.status !== lastStatus) {
        if (data.status === 'uploaded') addLog('📂 Waiting for Diarization trigger...', 'muted');
        if (data.status === 'diarizing') {
            addLog('🧠 Analyzing speaker signatures (Pyannote)...', 'info');
            if (startDiarizeBtn) startDiarizeBtn.disabled = true;
        }
        if (data.status === 'diarization_complete') addLog('✨ Diarization finished. Waiting for Transcription trigger...', 'info');
        if (data.status === 'transcribing') {
            addLog('🎤 Running Whisper transcription engine...', 'info');
            if (startTranscribeBtn) startTranscribeBtn.disabled = true;
        }
        if (data.status === 'aligning') addLog('🔗 Finalizing speaker alignment...', 'info');
        lastStatus = data.status;
    }

    // Handle live result segments (if transcribing locally)
    if (data.result && data.result.length > 0 && data.result.length > lastSegmentCount) {
        if (lastSegmentCount === 0) transcriptionContent.innerHTML = '';

        const newSegments = data.result.slice(lastSegmentCount);
        newSegments.forEach((seg, idx) => {
            const globalIdx = lastSegmentCount + idx;
            const div = createSegmentEl(seg, globalIdx);
            transcriptionContent.appendChild(div);
        });

        segments = data.result;
        lastSegmentCount = data.result.length;
        transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
    }
}


// ─── Speaker Management ───

const speakerInput = document.getElementById('speaker-input');
const addSpeakerBtn = document.getElementById('add-speaker-btn');
const speakerList = document.getElementById('speaker-list');

addSpeakerBtn.onclick = () => {
    const name = speakerInput.value.trim();
    if (name && !knownSpeakers.includes(name) && knownSpeakers.length < 10) {
        knownSpeakers.push(name);
        speakerInput.value = '';
        renderSpeakerList();
        refreshAllSegments();
    }
};

function renderSpeakerList() {
    speakerList.innerHTML = '';
    knownSpeakers.forEach(name => {
        const chip = document.createElement('div');
        chip.className = 'speaker-name-chip';
        chip.textContent = name;
        speakerList.appendChild(chip);
    });
}

function refreshAllSegments() {
    segments.forEach((seg, index) => {
        const el = document.getElementById(`segment-${index}`);
        if (el) {
            const selector = el.querySelector('.segment-speaker-selector');
            if (selector) selector.innerHTML = getSpeakerPillsHTML(index, seg.speaker);
        }
    });
}

function getSpeakerPillsHTML(index, activeSpeaker) {
    return knownSpeakers.map(name => `
        <span class="speaker-pill ${activeSpeaker === name ? 'active' : ''}" 
              onclick="setSegmentSpeaker(${index}, '${name}')">${name}</span>
    `).join('');
}

async function setSegmentSpeaker(index, name) {
    if (!currentTaskId) return;
    try {
        const response = await fetch('/update_speaker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task_id: currentTaskId,
                segment_index: index,
                speaker_name: name
            })
        });

        if (response.ok) {
            // Update all segments with the old speaker name
            const oldName = segments[index].speaker;
            segments.forEach((seg, i) => {
                if (seg.speaker === oldName) {
                    seg.speaker = name;
                    const el = document.getElementById(`segment-${i}`);
                    if (el) {
                        el.querySelector('.speaker-name').textContent = name;
                        el.querySelectorAll('.speaker-pill').forEach(pill => {
                            pill.classList.toggle('active', pill.textContent === name);
                        });
                    }
                }
            });
        }
    } catch (err) {
        console.error('Update failed:', err);
    }
}


// ─── Segment Rendering ───

function createSegmentEl(seg, index) {
    const div = document.createElement('div');
    div.className = 'transcription-segment';
    div.id = `segment-${index}`;
    div.innerHTML = `
        <div class="segment-header">
            <span class="speaker-name">${seg.speaker}</span>
            <span class="timestamp" onclick="seekTo(${seg.start})">${seg.timestamp}</span>
        </div>
        <div class="segment-text">${seg.text}</div>
        <div class="segment-speaker-selector">
            ${getSpeakerPillsHTML(index, seg.speaker)}
        </div>
    `;
    return div;
}

function seekTo(time) {
    wavesurfer.setTime(time);
    wavesurfer.play();
}

function highlightTranscription(currentTime) {
    let activeIndex = -1;
    segments.forEach((seg, index) => {
        const el = document.getElementById(`segment-${index}`);
        if (!el) return;

        const nextStart = segments[index + 1] ? segments[index + 1].start : Infinity;
        if (currentTime >= seg.start && currentTime < nextStart) {
            el.classList.add('active');
            activeIndex = index;
        } else {
            el.classList.remove('active');
        }
    });

    if (activeIndex !== -1) {
        const activeEl = document.getElementById(`segment-${activeIndex}`);
        const container = transcriptionContent;
        const target = activeEl.offsetTop - container.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
        container.scrollTo({ top: target, behavior: 'smooth' });
    }
}


// ─── Controls ───

playPauseBtn.onclick = () => wavesurfer.playPause();
document.getElementById('skip-back-15').onclick = () => wavesurfer.skip(-15);
document.getElementById('skip-back-5').onclick = () => wavesurfer.skip(-5);
document.getElementById('skip-forward-5').onclick = () => wavesurfer.skip(5);
document.getElementById('skip-forward-15').onclick = () => wavesurfer.skip(15);

document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.onclick = () => {
        const speed = parseFloat(btn.dataset.speed);
        if (wavesurfer) {
            wavesurfer.setPlaybackRate(speed);
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }
    };
});

document.getElementById('open-md-btn').onclick = () => {
    const md = mdFilenameSpan.textContent;
    if (md) window.open(`/download/${md}`, '_blank');
};

document.getElementById('open-docx-btn').onclick = () => {
    const docx = docxFilenameSpan.textContent;
    if (docx) window.open(`/download/${docx}`, '_blank');
};

removeFileBtn.onclick = () => {
    launchScreen.classList.remove('hidden');
    mainInterface.classList.add('hidden');
    if (wavesurfer) wavesurfer.destroy();
    currentTaskId = null;
    segments = [];
    transcriptionContent.innerHTML = '<div class="placeholder-text">Your transcription will appear here...</div>';
};

window.seekTo = seekTo;
window.setSegmentSpeaker = setSegmentSpeaker;
