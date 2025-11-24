/**
 * nav-gps.js
 * GPS定位处理模块
 * 负责GPS数据过滤、坐标转换、历史记录管理
 */

const NavGPS = (function() {
    'use strict';

    // GPS配置
    let config = {
        filterEnabled: true,           // GPS过滤开关
        maxJumpDistance: 100,          // 最大跳跃距离（米）- 放宽以容忍初始偏差
        maxHistorySize: 5,             // 历史记录大小
        maxAccuracy: 500,              // 最大允许精度误差（米）- 放宽，避免弱信号下不更新
        maxSpeed: 15,                  // 最大速度（米/秒，54km/h）- 工地车辆速度较慢
        minMovement: 0.3,              // 最小移动距离（米）- 放宽，微小移动也更新UI
        highAccuracy: true,            // 启用高精度模式
        timeout: 15000,                // 定位超时（毫秒）
        maximumAge: 0                  // 不使用缓存
    };

    // GPS历史记录
    let recentPositions = [];
    let lastPosition = null;
    let lastUpdateTime = 0;
    let lastHeading = 0; // 最近一次有效朝向（度）

    // watchPosition ID
    let watchId = null;

    // 定时器ID（用于2秒间隔定位）
    let intervalId = null;

    // 回调函数
    let onPositionUpdate = null;
    let onError = null;

    /**
     * 初始化GPS模块
     * @param {Object} options - 配置选项
     */
    function init(options = {}) {
        try {
            if (typeof MapConfig !== 'undefined' && MapConfig && MapConfig.navigationConfig) {
                const navConfig = MapConfig.navigationConfig;

                if (typeof navConfig.gpsFilterEnabled === 'boolean') {
                    config.filterEnabled = navConfig.gpsFilterEnabled;
                }
                if (typeof navConfig.gpsMaxJumpDistanceMeters === 'number') {
                    config.maxJumpDistance = navConfig.gpsMaxJumpDistanceMeters;
                }
                if (typeof navConfig.gpsMaxHistorySize === 'number') {
                    config.maxHistorySize = navConfig.gpsMaxHistorySize;
                }
            }

            Object.assign(config, options);

            if (!('geolocation' in navigator)) {
                console.error('[NavGPS] 浏览器不支持定位功能');
                return false;
            }

            return true;
        } catch (e) {
            console.error('[NavGPS] 初始化失败:', e);
            return false;
        }
    }

    /**
     * 校验GPS数据是否有效
     * @param {Array} position - [lng, lat]
     * @param {number} accuracy - GPS精度（米）
     * @returns {Object} { isValid, reason, isStationary }
     */
    function validatePosition(position, accuracy) {
        try {
            if (!config.filterEnabled) {
                return { isValid: true, reason: 'filter_disabled', isStationary: false };
            }

            if (recentPositions.length === 0) {
                return { isValid: true, reason: 'first_position', isStationary: false };
            }

            // 检查精度
            if (accuracy && accuracy > config.maxAccuracy) {
                return {
                    isValid: false,
                    reason: 'poor_accuracy',
                    details: `精度${accuracy}米 > ${config.maxAccuracy}米`,
                    isStationary: false
                };
            }

            const lastValid = recentPositions[recentPositions.length - 1];
            const jumpDist = calculateDistance(lastValid, position);

            // 检查是否是飘移（移动距离太小，可能是GPS抖动）
            if (jumpDist < config.minMovement) {
                // 移动距离小于1米，认为是静止或飘移，使用上一个有效位置
                return {
                    isValid: true,
                    reason: 'stationary_or_drift',
                    details: `移动${jumpDist.toFixed(2)}米 < ${config.minMovement}米，忽略`,
                    isStationary: true,
                    lastValidPosition: lastValid
                };
            }

            // 检查跳跃距离
            if (jumpDist > config.maxJumpDistance) {
                return {
                    isValid: false,
                    reason: 'jump_too_large',
                    details: `跳跃${jumpDist.toFixed(2)}米 > ${config.maxJumpDistance}米`,
                    isStationary: false
                };
            }

            // 检查速度
            if (lastUpdateTime > 0) {
                const timeDiff = (Date.now() - lastUpdateTime) / 1000;
                if (timeDiff > 0.1) {
                    const speed = jumpDist / timeDiff;
                    if (speed > config.maxSpeed) {
                        return {
                            isValid: false,
                            reason: 'speed_too_high',
                            details: `速度${speed.toFixed(2)}m/s > ${config.maxSpeed}m/s`,
                            isStationary: false
                        };
                    }
                }
            }

            if (recentPositions.length >= 3) {
                let avgDist = 0;
                for (const histPos of recentPositions) {
                    avgDist += calculateDistance(histPos, position);
                }
                avgDist /= recentPositions.length;

                const deviationThreshold = config.maxJumpDistance * 0.8;
                if (avgDist > deviationThreshold) {
                    return {
                        isValid: false,
                        reason: 'deviation_from_history',
                        details: `与历史偏差${avgDist.toFixed(2)}米`
                    };
                }
            }

            return {
                isValid: true,
                reason: 'passed_all_checks',
                details: `跳跃距离${jumpDist.toFixed(2)}米`
            };
        } catch (e) {
            console.error('[NavGPS] 校验失败:', e);
            return { isValid: false, reason: 'validation_error' };
        }
    }

    /**
     * 计算两点间距离（米）
     * @param {Array} pos1 - [lng, lat]
     * @param {Array} pos2 - [lng, lat]
     * @returns {number} 距离（米）
     */
    function calculateDistance(pos1, pos2) {
        try {
            // 优先使用高德API
            if (typeof AMap !== 'undefined' && AMap.GeometryUtil) {
                return AMap.GeometryUtil.distance(pos1, pos2);
            }

            // 回退到简单计算（Haversine公式）
            const [lng1, lat1] = pos1;
            const [lng2, lat2] = pos2;

            const R = 6371000; // 地球半径（米）
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;

            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                     Math.sin(dLng / 2) * Math.sin(dLng / 2);

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        } catch (e) {
            console.error('[NavGPS] 距离计算失败:', e);
            return 0;
        }
    }

    /**
     * WGS84坐标转GCJ-02（火星坐标系）
     * @param {number} lng - 经度
     * @param {number} lat - 纬度
     * @returns {Array} [lng, lat]
     */
    function convertCoordinates(lng, lat) {
        try {
            // 使用全局坐标转换函数（如果存在）
            if (typeof wgs84ToGcj02 === 'function') {
                const converted = wgs84ToGcj02(lng, lat);
                if (Array.isArray(converted) && converted.length === 2) {
                    return converted;
                }
            }

            // 如果没有转换函数，返回原坐标
            console.warn('[NavGPS] 坐标转换函数不存在，使用原始坐标');
            return [lng, lat];
        } catch (e) {
            console.error('[NavGPS] 坐标转换失败:', e);
            return [lng, lat];
        }
    }

    /**
     * 添加有效位置到历史记录
     * @param {Array} position - [lng, lat]
     */
    function addToHistory(position) {
        recentPositions.push(position);
        // 保持历史记录大小
        while (recentPositions.length > config.maxHistorySize) {
            recentPositions.shift();
        }
    }

    /**
     * 清空历史记录
     */
    function clearHistory() {
        recentPositions = [];
        lastPosition = null;
        lastUpdateTime = 0;
    }

    /**
     * 检查并请求定位权限
     * @returns {Promise<boolean>} 是否获得权限
     */
    async function checkAndRequestPermission() {
        try {
            if (!('geolocation' in navigator)) {
                console.error('[NavGPS] 浏览器不支持定位功能');
                alert('您的浏览器不支持定位功能，请使用支持定位的浏览器');
                return false;
            }

            // 检查权限API是否可用
            if ('permissions' in navigator) {
                try {
                    const result = await navigator.permissions.query({ name: 'geolocation' });

                    if (result.state === 'granted') {
                        console.log('[NavGPS] 定位权限已授予');
                        return true;
                    } else if (result.state === 'prompt') {
                        console.log('[NavGPS] 需要请求定位权限');
                        // 权限会在调用 getCurrentPosition 时请求
                        return await requestLocation();
                    } else if (result.state === 'denied') {
                        console.error('[NavGPS] 定位权限被拒绝');
                        alert('定位权限被拒绝，请在浏览器设置中允许定位权限后重试');
                        return false;
                    }
                } catch (e) {
                    console.warn('[NavGPS] 权限API不可用，尝试直接请求定位:', e);
                    return await requestLocation();
                }
            } else {
                // 权限API不可用，直接尝试获取定位
                console.log('[NavGPS] 权限API不可用，直接请求定位');
                return await requestLocation();
            }
        } catch (e) {
            console.error('[NavGPS] 检查定位权限失败:', e);
            return false;
        }
    }

    /**
     * 请求定位（用于触发权限请求）
     * @returns {Promise<boolean>}
     */
    function requestLocation() {
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('[NavGPS] 定位成功，权限已授予');
                    resolve(true);
                },
                (error) => {
                    console.error('[NavGPS] 定位失败:', error);

                    if (error.code === error.PERMISSION_DENIED) {
                        alert('定位权限被拒绝，请在浏览器设置中允许定位权限后重试');
                    } else if (error.code === error.POSITION_UNAVAILABLE) {
                        alert('无法获取位置信息，请检查GPS是否开启');
                    } else if (error.code === error.TIMEOUT) {
                        alert('定位超时，请稍后重试');
                    } else {
                        alert('定位失败，请稍后重试');
                    }

                    resolve(false);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }

    /**
     * 开始GPS监听（使用watchPosition持续监听）
     * @param {Function} onUpdate - 位置更新回调 (position, accuracy)
     * @param {Function} onErr - 错误回调 (error)
     * @returns {boolean} 是否启动成功
     */
    function startWatch(onUpdate, onErr) {
        try {
            if (!('geolocation' in navigator)) {
                console.error('[NavGPS] 浏览器不支持定位');
                if (onErr) onErr(new Error('浏览器不支持定位'));
                return false;
            }

            onPositionUpdate = onUpdate;
            onError = onErr;

            if (watchId !== null || intervalId !== null) {
                stopWatch();
            }

            clearHistory();

            // 使用watchPosition持续监听位置变化
            // 系统会自动在位置变化时推送更新，无需手动轮询
            watchId = navigator.geolocation.watchPosition(
                handlePosition,
                handleError,
                {
                    enableHighAccuracy: config.highAccuracy,
                    timeout: config.timeout,
                    maximumAge: 0  // 不使用缓存，确保获取最新位置
                }
            );

            console.log('[NavGPS] GPS监听已启动（watchPosition模式）');
            return true;
        } catch (e) {
            console.error('[NavGPS] 启动GPS监听失败:', e);
            if (onErr) onErr(e);
            return false;
        }
    }

    /**
     * 处理GPS位置更新
     * @private
     */
    function handlePosition(position) {
        try {
            let lng = position.coords.longitude;
            let lat = position.coords.latitude;
            const accuracy = position.coords.accuracy || 10;
            let headingRaw = position.coords.heading; // 可能为 null / NaN / -1

            const converted = convertCoordinates(lng, lat);
            lng = converted[0];
            lat = converted[1];

            const pos = [lng, lat];
            const validation = validatePosition(pos, accuracy);

            // 检查是否无效（精度差、跳跃太大、速度太快等）
            if (!validation.isValid) {
                // 无效数据，忽略
                return;
            }

            // 检查是否是静止/飘移
            // 计算或回退朝向
            const computedHeading = computeHeading(pos, validation.isStationary);

            if (validation.isStationary) {
                // 静止：不加入历史，但仍推送当前坐标与朝向（防止图标停滞）
                if (onPositionUpdate) {
                    onPositionUpdate(pos, accuracy, computedHeading);
                }
                return;
            }

            // 有效的移动，更新历史记录
            addToHistory(pos);
            lastPosition = pos;
            lastUpdateTime = Date.now();

            if (onPositionUpdate) {
                onPositionUpdate(pos, accuracy, computedHeading);
            }
        } catch (e) {
            console.error('[NavGPS] 处理GPS位置失败:', e);
        }
    }

    // 根据原始 heading 或两点计算 bearing，回退到 lastHeading
    function computeHeading(currentPos, isStationary) {
        try {
            let heading = null;
            // 尝试使用原始 headingRaw
            if (typeof headingRaw === 'number' && !isNaN(headingRaw) && headingRaw >= 0) {
                heading = headingRaw;
            }

            // 原始 heading 不可靠时，使用最近一次有效移动方向
            if (heading == null) {
                if (recentPositions.length > 0) {
                    const prev = recentPositions[recentPositions.length - 1];
                    const b = bearingBetween(prev, currentPos);
                    if (!isNaN(b)) heading = b;
                }
            }

            // 静止时保持最后朝向
            if (isStationary && heading == null) {
                heading = lastHeading;
            }

            if (heading == null) heading = lastHeading;

            // 归一化
            heading = ((heading % 360) + 360) % 360;
            lastHeading = heading;
            return heading;
        } catch (e) {
            return lastHeading;
        }
    }

    function bearingBetween(pos1, pos2) {
        const [lng1, lat1] = pos1;
        const [lng2, lat2] = pos2;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        brng = (brng + 360) % 360;
        return brng;
    }

    /**
     * 处理GPS错误
     * @private
     */
    function handleError(error) {
        console.error('[NavGPS] GPS错误:', error.message);

        const errorMessages = {
            1: '用户拒绝了定位权限',
            2: '无法获取位置信息',
            3: '获取位置超时'
        };

        const msg = errorMessages[error.code] || '未知错误';
        console.error('[NavGPS] 错误详情:', msg);

        if (onError) {
            onError(error);
        }
    }

    /**
     * 停止GPS监听
     */
    function stopWatch() {
        try {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
            }
            console.log('[NavGPS] GPS监听已停止');
        } catch (e) {
            console.error('[NavGPS] 停止GPS监听失败:', e);
        }
    }

    /**
     * 获取当前状态
     * @returns {Object}
     */
    function getStatus() {
        return {
            watching: intervalId !== null,
            lastPosition: lastPosition,
            lastUpdateTime: lastUpdateTime,
            historySize: recentPositions.length,
            config: { ...config }
        };
    }

    /**
     * 获取最后一次有效位置
     * @returns {Array|null} [lng, lat]
     */
    function getLastValidPosition() {
        if (recentPositions.length > 0) {
            return recentPositions[recentPositions.length - 1];
        }
        return lastPosition;
    }

    // 公开API
    return {
        init,
        checkAndRequestPermission,
        startWatch,
        stopWatch,
        clearHistory,
        validatePosition,
        calculateDistance,
        convertCoordinates,
        getStatus,
        getLastValidPosition
    };
})();

// 导出到全局
window.NavGPS = NavGPS;
