document.addEventListener('DOMContentLoaded', () => {
    const audioPlayer = document.getElementById('audioPlayer');
    const videoPlayer = document.getElementById('videoPlayer');
    const playlist = document.getElementById('playlist');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const loopBtn = document.getElementById('loopBtn');
    const shuffleBtn = document.getElementById('shuffleBtn');
    const volumeControl = document.getElementById('volumeControl');
    const progressBar = document.querySelector('.progress-bar');
    const progress = document.getElementById('progress');
    const currentTimeEl = document.getElementById('currentTime');
    const durationEl = document.getElementById('duration');
    const noMedia = document.getElementById('noMedia');
    const coverImage = document.getElementById('coverImage');
    const volumePercent = document.getElementById('volumePercent');

    let mediaFiles = [];
    let currentIndex = -1;
    let isLooping = false;
    let isShuffled = false;
    let currentPlayer = null;

    // IndexedDB配置
    const DB_NAME = 'MusicPlayerDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'mediaFiles';
    let db = null;

    // 初始化IndexedDB
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    // 保存文件到IndexedDB
    async function saveFileToDB(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                
                const fileData = {
                    name: file.name,
                    type: file.type,
                    data: e.target.result,
                    size: file.size,
                    lastModified: file.lastModified
                };
                
                const request = store.add(fileData);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    // 从IndexedDB加载所有文件
    async function loadFilesFromDB() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const files = request.result.map(fileData => {
                    // 将ArrayBuffer转换回File对象
                    const blob = new Blob([fileData.data], { type: fileData.type });
                    return new File([blob], fileData.name, {
                        type: fileData.type,
                        lastModified: fileData.lastModified
                    });
                });
                resolve(files);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // 清空IndexedDB
    async function clearDB() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // 记忆播放功能 - 保存播放状态
    function savePlaybackState() {
        if (currentIndex >= 0 && mediaFiles.length > 0) {
            const state = {
                currentIndex: currentIndex,
                currentTime: currentPlayer ? currentPlayer.currentTime : 0,
                volume: volumeControl.value,
                isLooping: isLooping,
                isShuffled: isShuffled,
                fileNames: mediaFiles.map(f => f.name)
            };
            localStorage.setItem('musicPlayerState', JSON.stringify(state));
        }
    }

    // 保存文件信息到localStorage
    function saveFilesToStorage() {
        // 由于安全限制，我们无法直接保存文件对象，只能保存文件名和类型
        const fileInfo = mediaFiles.map(file => ({
            name: file.name,
            type: file.type
        }));
        localStorage.setItem('musicPlayerFiles', JSON.stringify(fileInfo));
    }

    // 从localStorage加载文件信息
    function loadFilesFromStorage() {
        const savedFiles = localStorage.getItem('musicPlayerFiles');
        if (savedFiles) {
            try {
                return JSON.parse(savedFiles);
            } catch (e) {
                console.error('Failed to load files from storage:', e);
            }
        }
        return [];
    }

    // 记忆播放功能 - 加载播放状态
    function loadPlaybackState() {
        const savedState = localStorage.getItem('musicPlayerState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                if (state.volume) {
                    volumeControl.value = state.volume;
                    volumePercent.textContent = `${Math.round(state.volume * 100)}%`;
                }
                if (state.isLooping) {
                    isLooping = true;
                    loopBtn.style.color = '#764ba2';
                    loopBtn.style.background = 'rgba(118, 75, 162, 0.25)';
                    loopBtn.style.borderColor = 'rgba(118, 75, 162, 0.6)';
                }
                if (state.isShuffled) {
                    isShuffled = true;
                    shuffleBtn.style.color = '#667eea';
                    shuffleBtn.style.background = 'rgba(102, 126, 234, 0.25)';
                    shuffleBtn.style.borderColor = 'rgba(102, 126, 234, 0.6)';
                }
                return state;
            } catch (e) {
                console.error('Failed to load playback state:', e);
            }
        }
        return null;
    }

    uploadBtn.addEventListener('click', () => {
        fileInput.click();
        gsap.to(uploadBtn, {
            scale: 0.95,
            duration: 0.1,
            yoyo: true,
            repeat: 1,
            ease: 'power2.inOut'
        });
    });

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        const isFirstLoad = mediaFiles.length === 0;
        
        // 先添加到内存并显示到播放列表（快速响应）
        mediaFiles = [...mediaFiles, ...files];
        renderPlaylist();
        
        // 显示保存提示
        showSaveNotification(`正在保存 ${files.length} 个文件...`);
        
        // 在后台异步保存文件到IndexedDB
        setTimeout(async () => {
            let savedCount = 0;
            for (const file of files) {
                try {
                    await saveFileToDB(file);
                    savedCount++;
                } catch (error) {
                    console.error('保存文件失败:', error);
                }
            }
            showSaveNotification(`已保存 ${savedCount} 个文件`, 2000);
        }, 100);
        
        // 保存播放状态
        savePlaybackState();
        
        if (isFirstLoad && mediaFiles.length > 0) {
            // 首次加载时尝试恢复之前的播放状态
            const savedState = loadPlaybackState();
            if (savedState && savedState.currentIndex < mediaFiles.length) {
                loadMedia(savedState.currentIndex);
                if (currentPlayer && savedState.currentTime) {
                    currentPlayer.addEventListener('loadedmetadata', function restoreTime() {
                        currentPlayer.currentTime = savedState.currentTime;
                        currentPlayer.removeEventListener('loadedmetadata', restoreTime);
                    });
                }
            } else {
                loadMedia(0);
            }
        } else if (currentIndex === -1 && mediaFiles.length > 0) {
            loadMedia(0);
        }
    });

    // 显示保存提示
    function showSaveNotification(message, duration = 0) {
        // 移除已有的提示
        const existingNotification = document.querySelector('.save-notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.className = 'save-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #00FFFF, #00DDDD);
            color: #000;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: bold;
            z-index: 10000;
            box-shadow: 0 4px 15px rgba(0, 255, 255, 0.5);
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        }
    }

    function renderPlaylist() {
        playlist.innerHTML = '';
        mediaFiles.forEach((file, index) => {
            const li = document.createElement('li');
            const isVideo = file.type.startsWith('video');
            const icon = isVideo ? '🎬' : '🎵';
            li.innerHTML = `<span class="text-xl">${icon}</span> <span class="ml-2 truncate">${file.name}</span>`;
            li.addEventListener('click', () => loadMedia(index));
            if (index === currentIndex) li.classList.add('playing');
            
            // 添加鼠标进入效果
            li.addEventListener('mouseenter', function() {
                if (!this.classList.contains('playing')) {
                    gsap.to(this, { 
                        x: 10, 
                        scale: 1.02,
                        duration: 0.25, 
                        ease: 'power2.out' 
                    });
                }
            });
            
            // 添加鼠标离开效果
            li.addEventListener('mouseleave', function() {
                if (!this.classList.contains('playing')) {
                    gsap.to(this, { 
                        x: 0, 
                        scale: 1,
                        duration: 0.25, 
                        ease: 'power2.out',
                        clearProps: 'all'
                    });
                }
            });
            
            playlist.appendChild(li);
        });
        // 添加列表项入场动画，但保持可见性
        gsap.from('#playlist li', {
            x: -20,
            duration: 0.3,
            stagger: 0.05,
            ease: 'power2.out'
        });
    }

    function loadMedia(index) {
        if (index < 0 || index >= mediaFiles.length) return;
        
        currentIndex = index;
        const file = mediaFiles[index];
        const isVideo = file.type.startsWith('video');

        if (currentPlayer) {
            currentPlayer.pause();
            currentPlayer.currentTime = 0;
        }

        audioPlayer.classList.add('hidden');
        videoPlayer.classList.add('hidden');
        noMedia.classList.add('hidden');
        coverImage.classList.add('hidden');

        if (isVideo) {
            videoPlayer.src = URL.createObjectURL(file);
            videoPlayer.classList.remove('hidden');
            currentPlayer = videoPlayer;
            gsap.from(videoPlayer, { 
                opacity: 0, 
                scale: 0.95, 
                duration: 0.6,
                ease: 'power3.out'
            });
        } else {
            audioPlayer.src = URL.createObjectURL(file);
            audioPlayer.classList.remove('hidden');
            currentPlayer = audioPlayer;
            
            coverImage.classList.remove('hidden');
            noMedia.classList.remove('hidden');
            noMedia.innerHTML = `
                <div class="text-6xl mb-4 animate-pulse">🎵</div>
                <p class="text-xl font-bold mb-2 truncate px-4">${file.name}</p>
                <p class="text-sm opacity-60">正在播放</p>
            `;
            
            gsap.from(coverImage, { 
                opacity: 0, 
                scale: 0.9,
                rotation: -10,
                duration: 0.8,
                ease: 'back.out(1.7)'
            });
            
            gsap.from(noMedia, { 
                opacity: 0, 
                y: 30, 
                duration: 0.6,
                delay: 0.3,
                ease: 'power2.out'
            });

            gsap.to(coverImage, {
                rotation: 360,
                duration: 20,
                repeat: -1,
                ease: 'linear'
            });
        }

        currentPlayer.volume = volumeControl.value;
        currentPlayer.play();
        playBtn.innerHTML = '<span class="text-4xl">⏸</span>';
        renderPlaylist();

        // 保存播放状态
        savePlaybackState();

        gsap.to(playBtn, { 
            scale: 1.15, 
            duration: 0.3, 
            ease: 'back.out(2)',
            yoyo: true, 
            repeat: 1 
        });
    }

    playBtn.addEventListener('click', () => {
        if (!currentPlayer || currentIndex === -1) return;
        
        if (currentPlayer.paused) {
            currentPlayer.play();
            playBtn.innerHTML = '<span class="text-4xl">⏸</span>';
            gsap.to(playBtn, { 
                scale: 1.2, 
                duration: 0.25,
                ease: 'elastic.out(1, 0.5)',
                yoyo: true, 
                repeat: 1 
            });
            
            if (!videoPlayer.classList.contains('hidden')) {
                gsap.to(coverImage, {
                    rotation: '+=360',
                    duration: 20,
                    repeat: -1,
                    ease: 'linear'
                });
            }
        } else {
            currentPlayer.pause();
            playBtn.innerHTML = '<span class="text-4xl">▶</span>';
            gsap.to(playBtn, { 
                scale: 1.2, 
                duration: 0.25,
                ease: 'elastic.out(1, 0.5)',
                yoyo: true, 
                repeat: 1 
            });
            gsap.killTweensOf(coverImage);
        }
    });

    stopBtn.addEventListener('click', () => {
        if (!currentPlayer) return;
        
        currentPlayer.pause();
        currentPlayer.currentTime = 0;
        playBtn.innerHTML = '<span class="text-4xl">▶</span>';
        progress.style.width = '0%';
        currentTimeEl.textContent = '0:00';
        
        gsap.to(stopBtn, { 
            scale: 1.3, 
            duration: 0.25,
            ease: 'back.out(2)',
            yoyo: true, 
            repeat: 1 
        });
        gsap.killTweensOf(coverImage);
    });

    prevBtn.addEventListener('click', () => {
        if (mediaFiles.length === 0) return;
        currentIndex = (currentIndex - 1 + mediaFiles.length) % mediaFiles.length;
        loadMedia(currentIndex);
        gsap.to(prevBtn, { 
            rotation: -360, 
            duration: 0.6,
            ease: 'power2.out'
        });
        gsap.set(prevBtn, { rotation: 0, delay: 0.6 });
    });

    nextBtn.addEventListener('click', () => {
        if (mediaFiles.length === 0) return;
        currentIndex = (currentIndex + 1) % mediaFiles.length;
        loadMedia(currentIndex);
        gsap.to(nextBtn, { 
            rotation: 360, 
            duration: 0.6,
            ease: 'power2.out'
        });
        gsap.set(nextBtn, { rotation: 0, delay: 0.6 });
    });

    volumeControl.addEventListener('input', (e) => {
        const volume = e.target.value;
        if (currentPlayer) {
            currentPlayer.volume = volume;
        }
        volumePercent.textContent = `${Math.round(volume * 100)}%`;
        
        // 保存音量设置
        savePlaybackState();
        
        gsap.to(volumePercent, {
            scale: 1.2,
            duration: 0.2,
            yoyo: true,
            repeat: 1,
            ease: 'power2.out'
        });
    });

    progressBar.addEventListener('click', (e) => {
        if (!currentPlayer || !currentPlayer.duration) return;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        currentPlayer.currentTime = percent * currentPlayer.duration;
        
        gsap.from(progress, {
            scaleX: 0.95,
            duration: 0.3,
            ease: 'power2.out'
        });
    });

    function updateProgress() {
        if (!currentPlayer || !currentPlayer.duration) return;
        const percent = (currentPlayer.currentTime / currentPlayer.duration) * 100;
        progress.style.width = `${percent}%`;
        currentTimeEl.textContent = formatTime(currentPlayer.currentTime);
        durationEl.textContent = formatTime(currentPlayer.duration);
        
        // 每5秒保存一次播放进度
        if (Math.floor(currentPlayer.currentTime) % 5 === 0) {
            savePlaybackState();
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    [audioPlayer, videoPlayer].forEach(player => {
        player.addEventListener('timeupdate', updateProgress);
        player.addEventListener('loadedmetadata', updateProgress);
        player.addEventListener('ended', () => {
            if (isLooping) {
                player.currentTime = 0;
                player.play();
            } else {
                nextBtn.click();
            }
        });
    });

    loopBtn.addEventListener('click', () => {
        isLooping = !isLooping;
        loopBtn.style.color = isLooping ? '#764ba2' : '';
        loopBtn.style.background = isLooping ? 'rgba(118, 75, 162, 0.25)' : '';
        loopBtn.style.borderColor = isLooping ? 'rgba(118, 75, 162, 0.6)' : '';
        
        // 保存循环状态
        savePlaybackState();
        
        gsap.to(loopBtn, { 
            scale: 1.4, 
            duration: 0.3,
            ease: 'back.out(2)',
            yoyo: true, 
            repeat: 1 
        });
    });

    shuffleBtn.addEventListener('click', () => {
        isShuffled = !isShuffled;
        shuffleBtn.style.color = isShuffled ? '#667eea' : '';
        shuffleBtn.style.background = isShuffled ? 'rgba(102, 126, 234, 0.25)' : '';
        shuffleBtn.style.borderColor = isShuffled ? 'rgba(102, 126, 234, 0.6)' : '';
        gsap.to(shuffleBtn, { 
            scale: 1.4, 
            duration: 0.3,
            ease: 'back.out(2)',
            yoyo: true, 
            repeat: 1 
        });
        
        if (isShuffled) {
            const currentFile = mediaFiles[currentIndex];
            mediaFiles.sort(() => Math.random() - 0.5);
            currentIndex = mediaFiles.indexOf(currentFile);
        } else {
            const currentFile = mediaFiles[currentIndex];
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
            currentIndex = mediaFiles.indexOf(currentFile);
        }
        renderPlaylist();
        
        // 保存随机播放状态
        savePlaybackState();
    });

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            playBtn.click();
        } else if (e.code === 'ArrowLeft') {
            prevBtn.click();
        } else if (e.code === 'ArrowRight') {
            nextBtn.click();
        } else if (e.code === 'ArrowUp') {
            e.preventDefault();
            volumeControl.value = Math.min(1, parseFloat(volumeControl.value) + 0.1);
            volumeControl.dispatchEvent(new Event('input'));
        } else if (e.code === 'ArrowDown') {
            e.preventDefault();
            volumeControl.value = Math.max(0, parseFloat(volumeControl.value) - 0.1);
            volumeControl.dispatchEvent(new Event('input'));
        }
    });

    gsap.from('.player-container', {
        opacity: 0,
        scale: 0.9,
        duration: 1.2,
        ease: 'power3.out'
    });

    gsap.from('.control-btn', {
        opacity: 0,
        y: 40,
        duration: 0.8,
        stagger: 0.12,
        delay: 0.6,
        ease: 'back.out(1.5)'
    });

    // 初始化IndexedDB并加载文件
    initDB().then(async () => {
        // 从IndexedDB加载文件
        try {
            const savedFiles = await loadFilesFromDB();
            if (savedFiles.length > 0) {
                mediaFiles = savedFiles;
                renderPlaylist();
                
                // 恢复播放状态
                const savedState = loadPlaybackState();
                if (savedState && savedState.currentIndex < mediaFiles.length) {
                    loadMedia(savedState.currentIndex);
                    if (currentPlayer && savedState.currentTime) {
                        currentPlayer.addEventListener('loadedmetadata', function restoreTime() {
                            currentPlayer.currentTime = savedState.currentTime;
                            currentPlayer.removeEventListener('loadedmetadata', restoreTime);
                        });
                    }
                }
            }
        } catch (error) {
            console.error('加载文件失败:', error);
        }
    }).catch(error => {
        console.error('初始化数据库失败:', error);
    });
    
    // 显示上传按钮的提示
    uploadBtn.title = '点击添加音频或视频文件';
    
    // 确保上传按钮始终可见
    uploadBtn.style.display = 'block';
    uploadBtn.style.visibility = 'visible';
    uploadBtn.style.opacity = '1';
    
    // 添加入场动画，但确保动画后按钮保持可见
    gsap.from('#uploadBtn', {
        opacity: 0,
        scale: 0.8,
        duration: 0.8,
        delay: 0.3,
        ease: 'elastic.out(1, 0.5)',
        onComplete: function() {
            uploadBtn.style.display = 'block';
            uploadBtn.style.visibility = 'visible';
            uploadBtn.style.opacity = '1';
        }
    });
});