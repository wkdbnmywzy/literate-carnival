/**
 * nav-tts.js
 * 导航语音播报模块
 * 负责TTS初始化、队列管理、去重和回退机制
 */

const NavTTS = (function() {
    'use strict';

    // TTS 实例
    let ttsInstance = null;

    // 播报队列
    let speechQueue = [];
    let isSpeaking = false;

    // 播报抑制（避免短时间内重复）
    let suppressionUntil = 0;
    let lastSpeechText = '';
    let lastSpeechTime = 0;

    /**
     * 初始化TTS（优先使用讯飞，失败回退浏览器内置）
     * @returns {boolean} 是否初始化成功
     */
    function init() {
        try {
            console.log('[NavTTS] 初始化语音播报模块...');

            // 1. 优先使用 MapConfig 中的讯飞配置
            if (typeof MapConfig !== 'undefined' && MapConfig && MapConfig.xfyun) {
                const config = MapConfig.xfyun;
                if (config.appId && config.apiKey && config.apiSecret) {
                    try {
                        ttsInstance = new XunfeiTTS(config.appId, config.apiKey, config.apiSecret);
                        console.log('[NavTTS] ✓ 使用 MapConfig 中的讯飞TTS配置');
                        return true;
                    } catch (e) {
                        console.warn('[NavTTS] MapConfig 讯飞TTS初始化失败:', e);
                    }
                }
            }

            // 2. 复用全局讯飞TTS实例
            if (window.xfyunTTSInstance) {
                ttsInstance = window.xfyunTTSInstance;
                console.log('[NavTTS] ✓ 复用全局讯飞TTS实例');
                return true;
            }

            // 3. 回退到浏览器内置TTS
            ttsInstance = null;
            console.log('[NavTTS] ✓ 使用浏览器内置 SpeechSynthesis 作为回退');

            // 检查浏览器是否支持
            if (!('speechSynthesis' in window)) {
                console.warn('[NavTTS] ⚠ 浏览器不支持语音播报');
                return false;
            }

            return true;
        } catch (e) {
            console.error('[NavTTS] 初始化失败:', e);
            ttsInstance = null;
            return false;
        }
    }

    /**
     * 播报文字（统一接口）
     * @param {string} text - 播报内容
     * @param {Object} options - 配置选项
     *   - voice: 发音人（讯飞TTS专用）
     *   - suppressionMs: 抑制时长（毫秒），默认3000ms
     *   - force: 是否强制播报（跳过去重检查）
     * @returns {Promise<boolean>} 是否加入队列
     */
    function speak(text, options = {}) {
        try {
            if (!text || typeof text !== 'string' || text.trim() === '') {
                console.warn('[NavTTS] 播报内容为空，已忽略');
                return Promise.resolve(false);
            }

            text = text.trim();

            // 去重检查（除非强制播报）
            if (!options.force) {
                // 1. 短时间抑制（避免重复）
                if (Date.now() < suppressionUntil) {
                    console.log('[NavTTS] 播报被抑制（短时间内重复）:', text);
                    return Promise.resolve(false);
                }

                // 2. 内容去重（5秒内相同内容不重复播报）
                const now = Date.now();
                if (text === lastSpeechText && (now - lastSpeechTime) < 5000) {
                    console.log('[NavTTS] 播报内容重复，已跳过:', text);
                    return Promise.resolve(false);
                }
            }

            // 设置抑制时长
            const suppressionMs = options.suppressionMs || 3000;
            suppressionUntil = Date.now() + suppressionMs;
            lastSpeechText = text;
            lastSpeechTime = Date.now();

            // 加入队列
            speechQueue.push({ text, options });
            console.log('[NavTTS] 加入播报队列:', text, `(队列长度: ${speechQueue.length})`);

            // 触发队列处理
            processQueue();

            return Promise.resolve(true);
        } catch (e) {
            console.error('[NavTTS] 播报失败:', e);
            return Promise.resolve(false);
        }
    }

    /**
     * 处理播报队列
     */
    function processQueue() {
        if (isSpeaking) {
            console.log('[NavTTS] 正在播报中，等待队列处理');
            return;
        }

        if (speechQueue.length === 0) {
            return;
        }

        const item = speechQueue.shift();
        if (!item || !item.text) {
            processQueue(); // 跳过无效项，继续处理
            return;
        }

        isSpeaking = true;
        const { text, options } = item;

        console.log('[NavTTS] 开始播报:', text);

        // 尝试使用讯飞TTS
        if (ttsInstance && typeof ttsInstance.speak === 'function') {
            ttsInstance.speak(text, options.voice)
                .then(() => {
                    console.log('[NavTTS] ✓ 讯飞TTS播报完成:', text);
                })
                .catch(err => {
                    console.warn('[NavTTS] 讯飞TTS播报失败，回退到浏览器TTS:', err);
                    return fallbackSpeak(text);
                })
                .finally(() => {
                    isSpeaking = false;
                    // 延迟处理下一条，避免冲突
                    setTimeout(processQueue, 120);
                });
        } else if (ttsInstance && typeof ttsInstance.synthesize === 'function') {
            // 兼容旧版本讯飞TTS接口
            ttsInstance.synthesize(text, options.voice)
                .then(() => {
                    console.log('[NavTTS] ✓ 讯飞TTS播报完成（synthesize）:', text);
                })
                .catch(err => {
                    console.warn('[NavTTS] 讯飞TTS播报失败，回退到浏览器TTS:', err);
                    return fallbackSpeak(text);
                })
                .finally(() => {
                    isSpeaking = false;
                    setTimeout(processQueue, 120);
                });
        } else {
            // 直接使用浏览器TTS
            fallbackSpeak(text)
                .finally(() => {
                    isSpeaking = false;
                    setTimeout(processQueue, 120);
                });
        }
    }

    /**
     * 浏览器内置TTS回退方案
     * @param {string} text - 播报内容
     * @returns {Promise<void>}
     */
    function fallbackSpeak(text) {
        return new Promise((resolve) => {
            try {
                if (!('speechSynthesis' in window)) {
                    console.warn('[NavTTS] 浏览器不支持 speechSynthesis');
                    resolve();
                    return;
                }

                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'zh-CN';
                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;

                utterance.onend = () => {
                    console.log('[NavTTS] ✓ 浏览器TTS播报完成:', text);
                    resolve();
                };

                utterance.onerror = (e) => {
                    console.error('[NavTTS] 浏览器TTS播报错误:', e);
                    resolve();
                };

                // 取消之前的播报
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utterance);
            } catch (e) {
                console.error('[NavTTS] fallbackSpeak 错误:', e);
                resolve();
            }
        });
    }

    /**
     * 立即停止所有播报
     */
    function stop() {
        try {
            console.log('[NavTTS] 停止所有播报');

            // 清空队列
            speechQueue = [];
            isSpeaking = false;

            // 停止讯飞TTS
            if (ttsInstance && typeof ttsInstance.stop === 'function') {
                ttsInstance.stop();
            }

            // 停止浏览器TTS
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        } catch (e) {
            console.error('[NavTTS] 停止播报失败:', e);
        }
    }

    /**
     * 清空播报队列
     */
    function clearQueue() {
        speechQueue = [];
        console.log('[NavTTS] 播报队列已清空');
    }

    /**
     * 重置抑制状态（允许立即播报）
     */
    function resetSuppression() {
        suppressionUntil = 0;
        lastSpeechText = '';
        lastSpeechTime = 0;
        console.log('[NavTTS] 播报抑制已重置');
    }

    /**
     * 获取当前状态
     * @returns {Object}
     */
    function getStatus() {
        return {
            initialized: ttsInstance !== null || ('speechSynthesis' in window),
            usingXunfei: ttsInstance !== null,
            isSpeaking: isSpeaking,
            queueLength: speechQueue.length,
            lastSpeechText: lastSpeechText,
            suppressionActive: Date.now() < suppressionUntil
        };
    }

    /**
     * 测试播报
     * @param {string} testText - 测试文本
     */
    function test(testText = '导航语音测试') {
        console.log('[NavTTS] 执行测试播报...');
        speak(testText, { force: true, suppressionMs: 0 });
    }

    // 公开API
    return {
        init,
        speak,
        stop,
        clearQueue,
        resetSuppression,
        getStatus,
        test
    };
})();

// 导出到全局
window.NavTTS = NavTTS;
