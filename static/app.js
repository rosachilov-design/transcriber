let wavesurfer;
let currentTaskId = null;
let statusInterval = null;
let segments = [];
let lastSegmentCount = 0;

// DOM Elements
const dropzone = document.getElementById('dropzone');
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

function initWaveSurfer(url) {
    if (wavesurfer) wavesurfer.destroy();

    wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#475569',
        progressColor: '#f97316',
        cursorColor: '#f97316',
        barWidth: 3,
        barGap: 3,
        barRadius: 4,
        responsive: true,
        height: 180,
        normalize: true
    });

    wavesurfer.load(url);

    wavesurfer.on('ready', () => {
        durationDisplay.textContent = formatTime(wavesurfer.getDuration());
    });

    wavesurfer.on('audioprocess', (time) => {
        currentTimeDisplay.textContent = formatTime(time);
        highlightTranscription(time);
    });

    wavesurfer.on('seek', (prog) => {
        const time = prog * wavesurfer.getDuration();
        currentTimeDisplay.textContent = formatTime(time);
        highlightTranscription(time);
    });

    wavesurfer.on('play', () => { playIcon.className = 'pause-icon'; });
    wavesurfer.on('pause', () => { playIcon.className = 'play-icon'; });
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragging');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
});

let knownSpeakers = [];

async function handleFile(file) {
    filenameDisplay.textContent = file.name;
    dropzone.classList.add('hidden');
    mainInterface.classList.remove('hidden');
    knownSpeakers = [];
    renderSpeakerList();

    const url = URL.createObjectURL(file);
    initWaveSurfer(url);

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        currentTaskId = data.task_id;
        // Don't start polling — wait for "Start Transcription" click
    } catch (err) {
        statusText.textContent = 'Upload failed';
    }
}

// Start Transcription button
const startTranscriptionBtn = document.getElementById('start-transcription-btn');
const progressSection = document.getElementById('progress-section');

startTranscriptionBtn.onclick = async () => {
    if (!currentTaskId) return;

    startTranscriptionBtn.disabled = true;
    startTranscriptionBtn.textContent = 'Starting...';

    try {
        const response = await fetch(`/transcribe/${currentTaskId}`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.status === 'started') {
            startTranscriptionBtn.classList.add('hidden');
            progressSection.classList.remove('hidden');
            startPolling();
        } else {
            startTranscriptionBtn.disabled = false;
            startTranscriptionBtn.textContent = 'Start Transcription';
        }
    } catch (err) {
        statusText.textContent = 'Failed to start transcription';
        startTranscriptionBtn.disabled = false;
        startTranscriptionBtn.textContent = 'Start Transcription';
    }
};

function startPolling() {
    if (statusInterval) clearInterval(statusInterval);
    lastSegmentCount = 0;

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
    }, 1000); // Poll every second for live feel
}

function updateUI(data) {
    progressBar.style.width = `${data.progress}%`;
    percentText.textContent = `${data.progress}%`;

    if (data.status === 'diarizing') {
        statusText.textContent = 'Identifying speakers...';
    } else if (data.status === 'aligning') {
        statusText.textContent = 'Aligning words to speakers...';
    } else if (data.status === 'transcribing') {
        statusText.textContent = 'Transcribing audio...';
    } else {
        statusText.textContent = data.status === 'completed' ? 'Transcription Finished' : 'Processing...';
    }

    if (data.result) {
        // 1. Handle new segments
        if (data.result.length > lastSegmentCount) {
            if (lastSegmentCount === 0) transcriptionContent.innerHTML = '';

            const newSegments = data.result.slice(lastSegmentCount);
            newSegments.forEach((seg, idx) => {
                const globalIdx = lastSegmentCount + idx;
                const div = createSegmentEl(seg, globalIdx);
                transcriptionContent.appendChild(div);
            });

            segments = data.result;
            lastSegmentCount = data.result.length;

            // Auto scroll
            transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
        }

        // 2. Update last segment text if it grew (due to live merging)
        else if (data.result.length === lastSegmentCount && lastSegmentCount > 0) {
            const lastIdx = lastSegmentCount - 1;
            const serverText = data.result[lastIdx].text;
            if (serverText !== segments[lastIdx].text) {
                segments[lastIdx].text = serverText;
                const lastEl = document.getElementById(`segment-${lastIdx}`);
                if (lastEl) {
                    lastEl.querySelector('.segment-text').textContent = serverText;
                    // Keep scroll at bottom during growth
                    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
                }
            }
        }
    }

    if (data.status === 'completed') {
        mdFilenameSpan.textContent = data.md_path;
        if (data.docx_path) docxFilenameSpan.textContent = data.docx_path;
        footerActions.classList.remove('hidden');
    }
}


// DOM Elements
const speakerInput = document.getElementById('speaker-input');
const addSpeakerBtn = document.getElementById('add-speaker-btn');
const speakerList = document.getElementById('speaker-list');

addSpeakerBtn.onclick = () => {
    const name = speakerInput.value.trim();
    if (name && !knownSpeakers.includes(name) && knownSpeakers.length < 5) {
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
            segments[index].speaker = name;
            const el = document.getElementById(`segment-${index}`);
            if (el) {
                el.querySelector('.speaker-name').textContent = name;
                el.querySelectorAll('.speaker-pill').forEach(pill => {
                    pill.classList.toggle('active', pill.textContent === name);
                });
            }
        }
    } catch (err) {
        console.error('Update failed:', err);
    }
}

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

// Controls
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


removeFileBtn.onclick = () => location.reload();

window.seekTo = seekTo;
window.setSegmentSpeaker = setSegmentSpeaker;
