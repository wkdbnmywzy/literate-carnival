/**
 * nav-core.js
 * 导航核心逻辑模块
 * 整合所有子模块，提供统一的导航控制接口
 */

const NavCore = (function() {
    'use strict';

    // ==================== 吸附阈值配置（全局变量，便于调整）====================
    const SNAP_THRESHOLD_NORMAL = 8;      // 常规吸附阈值（直线路段、偏离轨迹吸附KML）
    const SNAP_THRESHOLD_TURNING = 10;    // 转弯处吸附阈值（转弯时GPS误差大，放宽阈值）
    // ========================================================================

    // 导航状态
    let isNavigating = false;
    let navigationPath = [];
    let routeData = null;

    // 定时器
    let updateTimer = null;

    // 上一次播报
    let lastPromptMessage = '';
    let lastPromptTime = 0;

    // 点集吸附相关
    let currentSnappedIndex = -1;  // 当前吸附的点索引
    let lastSnappedIndex = -1;     // 上一次吸附的点索引
    let snappedPosition = null;    // 当前吸附的位置
    let lastTurningPointIndex = -1; // 上一次触发旋转的转向点索引
    let currentMapRotation = 0;    // 当前地图旋转角度（记录状态，避免重复旋转）

    // 分段导航相关
    let currentSegmentIndex = 0;   // 当前路段索引（0=起点到途径点1/终点，1=途径点1到途径点2...）
    let segmentRanges = [];        // 每段在点集中的索引范围 [{start, end, name}, ...]
    let completedSegments = [];    // 已完成的路段灰色路线（用于降低层级）

    // 导航提示相关
    let currentGuidance = null;     // 当前导航提示 { type, distance, action, ... }
    let lastGuidanceTime = 0;       // 上一次提示更新时间
    let nextTurningPointIndex = -1; // 下一个转向点索引
    let hasPrompted1_4 = false;     // 是否已提示过1/4距离
    let hasPromptedBefore = false;  // 是否已提示过转向点前一个点
    let isInSegmentTransition = false; // 是否在段间过渡中

    // 速度计算相关
    let gpsHistory = [];            // GPS历史记录 [{position, time, segmentIndex}, ...]
    let currentSpeed = 8.33;        // 当前速度（m/s），初始值为8.33m/s（30km/h）
    let lastStraightPromptTime = 0; // 上一次直行提示时间
    let lastPromptType = null;      // 上一次提示类型（用于避免重复）

    // 导航阶段状态
    let hasReachedStart = false;    // 是否已到达起点（用于切换位置图标）

    // 导航统计数据
    let navigationStartTime = null;  // 导航开始时间
    let totalTravelDistance = 0;     // 总行程距离（米）

    // 偏离检测防抖
    let deviationStartTime = 0;      // 开始偏离的时间戳
    let hasAnnouncedDeviation = false; // 是否已播报偏离
    let deviationCheckIntervalId = null; // 偏离检测期间的加速定时器

    // 转弯期间校验控制
    let isTurningPhase = false;      // 是否处于转弯阶段
    let turningPhaseEndTime = 0;     // 转弯阶段结束时间（播报"转弯"后3秒）

    // 设备朝向（导航页未引入首页 map-core.js，需要独立监听）
    let deviceHeading = null;       // 设备方向（0-360，正北为0，顺时针）
    let lastRawHeading = null;      // 上一次用于UI的有效朝向
    let lastPreStartPosition = null; // 起点前上一次GPS位置
    let orientationListening = false;
    let dynamicAngleOffset = 0;     // 0或180，自动校准用
    let calibrationLocked = false;
    let lastSmoothedAngle = null;   // 起点前用于显示的平滑角度

    function initDeviceOrientationListener() {
        if (orientationListening) return;
        try {
            const ua = navigator.userAgent || '';
            const isIOS = /iP(ad|hone|od)/i.test(ua);
            const isAndroid = /Android/i.test(ua);
            const requestIOS = () => {
                if (isIOS && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                    DeviceOrientationEvent.requestPermission().then(state => {
                        if (state === 'granted') attachOrientationEvents();
                    }).catch(() => {});
                } else {
                    attachOrientationEvents();
                }
            };
            function attachOrientationEvents() {
                const handler = (e) => {
                    let heading = null;
                    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
                        heading = e.webkitCompassHeading;
                    } else if (typeof e.alpha === 'number' && !isNaN(e.alpha)) {
                        // 使用 absolute 优先；普通 alpha 需转换为顺时针
                        heading = e.absolute === true ? e.alpha : (360 - e.alpha);
                        // Android 机型可能需要反转 absolute alpha
                        try {
                            if (e.absolute === true && isAndroid && MapConfig && MapConfig.orientationConfig && MapConfig.orientationConfig.androidNeedsInversion) {
                                heading = 360 - heading;
                            }
                        } catch (invErr) {}
                    }
                    if (heading !== null) {
                        if (heading < 0) heading += 360;
                        heading = heading % 360;
                        deviceHeading = heading;

                        // 起点前实时用设备朝向驱动图标旋转（与首页一致地“跟手”）
                        try {
                            if (isNavigating && !hasReachedStart) {
                                const finalAngleRaw = getAdjustedAngle(deviceHeading);
                                const finalAngle = smoothAngleEMA(lastSmoothedAngle, finalAngleRaw);
                                lastSmoothedAngle = finalAngle;
                                if (typeof NavRenderer.setUserMarkerAngle === 'function') {
                                    NavRenderer.setUserMarkerAngle(finalAngle);
                                }
                            }
                        } catch (err) {}
                    }
                };
                if ('ondeviceorientationabsolute' in window) {
                    window.addEventListener('deviceorientationabsolute', handler, true);
                } else {
                    window.addEventListener('deviceorientation', handler, true);
                }
                orientationListening = true;
            }
            requestIOS();
        } catch (e) {
            console.warn('[NavCore] 设备方向监听失败:', e);
        }
    }

    // 角度归一化 0..360
    function normAngle(a) {
        if (a === null || a === undefined || isNaN(a)) return 0;
        a = a % 360; if (a < 0) a += 360; return a;
    }

    // 角度绝对差 0..180
    function angleAbsDiff(a, b) {
        let d = ((a - b + 540) % 360) - 180; return Math.abs(d);
    }

    // 动态校准：对比设备heading与基于移动的bearing，稳定在180°附近则加180°偏移
    function attemptAutoCalibrationPreStart(curr, heading) {
        if (calibrationLocked) return;
        if (!lastPreStartPosition) return;
        if (heading === null || heading === undefined || isNaN(heading)) return;

        const dist = haversineDistance(lastPreStartPosition[1], lastPreStartPosition[0], curr[1], curr[0]);
        if (!isFinite(dist) || dist < 5) return; // 移动太小不校准

        const bearing = calculateBearing(lastPreStartPosition, curr);
        const diff = angleAbsDiff(heading, bearing);

        if (diff >= 155) { // 接近180°
            dynamicAngleOffset = 180;
            calibrationLocked = true;
        } else if (diff <= 25) { // 接近0°
            dynamicAngleOffset = 0;
            calibrationLocked = true;
        }
    }

    // 结合配置与地图旋转修正最终用于图标的角度
    function getAdjustedAngle(baseHeading) {
        let angle = normAngle(baseHeading);
        try {
            let cfgOffset = 0;
            if (MapConfig && MapConfig.orientationConfig && typeof MapConfig.orientationConfig.angleOffset === 'number') {
                cfgOffset = MapConfig.orientationConfig.angleOffset;
            }
            const mapObj = (typeof NavRenderer !== 'undefined' && NavRenderer.getMap) ? NavRenderer.getMap() : null;
            const mapRotation = mapObj && typeof mapObj.getRotation === 'function' ? (mapObj.getRotation() || 0) : 0;
            angle = angle + cfgOffset + (dynamicAngleOffset || 0) - (mapRotation || 0);
            angle = normAngle(angle);
        } catch (e) {}
        return angle;
    }

    // 角度EMA平滑（考虑环形角度，取最短差值）
    function smoothAngleEMA(prevAngle, currAngle) {
        try {
            const alpha = (MapConfig && MapConfig.orientationConfig && typeof MapConfig.orientationConfig.smoothingAlpha === 'number')
                ? Math.max(0, Math.min(1, MapConfig.orientationConfig.smoothingAlpha))
                : 0.25; // 默认平滑强度
            if (prevAngle === null || prevAngle === undefined || isNaN(prevAngle)) return normAngle(currAngle);
            const prev = normAngle(prevAngle);
            const curr = normAngle(currAngle);
            const delta = ((curr - prev + 540) % 360) - 180; // -180..180 最近路径
            return normAngle(prev + alpha * delta);
        } catch (e) {
            return normAngle(currAngle);
        }
    }

    /**
     * 初始化导航核心模块
     * @param {string} mapContainerId - 地图容器ID
     * @returns {boolean}
     */
    function init(mapContainerId) {
        try {
            if (!NavTTS.init()) {
                console.warn('[NavCore] TTS初始化失败');
            }

            if (!NavGPS.init()) {
                console.error('[NavCore] GPS初始化失败');
                return false;
            }

            const map = NavRenderer.initMap(mapContainerId);
            if (!map) {
                console.error('[NavCore] 地图初始化失败');
                return false;
            }

            // 初始化设备方向监听（用于起点前“我的位置”图标朝向）
            initDeviceOrientationListener();

            map.on('complete', onMapComplete);
            NavGuidance.init();

            return true;
        } catch (e) {
            console.error('[NavCore] 初始化失败:', e);
            return false;
        }
    }

    /**
     * 地图加载完成回调
     */
    function onMapComplete() {
        loadKMLData();
        loadRouteData();
    }

    /**
     * 加载KML数据
     */
    function loadKMLData() {
        try {
            const processedData = NavDataStore.getProcessedKMLData();
            if (processedData) {
                NavRenderer.loadKMLData(processedData);
                syncKMLLayersToGlobal();
            }
        } catch (e) {
            console.error('[NavCore] 加载KML数据失败:', e);
        }
    }

    /**
     * 同步KML图层到全局变量
     */
    function syncKMLLayersToGlobal() {
        try {
            if (typeof window.kmlLayers === 'undefined') {
                console.error('[NavCore] window.kmlLayers 未定义');
                return false;
            }

            const layers = NavRenderer.getKMLLayers();
            if (layers && layers.length > 0) {
                window.kmlLayers.length = 0;
                window.kmlLayers.push(...layers);
                return true;
            }
            return false;
        } catch (e) {
            console.error('[NavCore] 同步KML图层失败:', e);
            return false;
        }
    }

    /**
     * 加载路线数据
     */
    function loadRouteData() {
        try {
            routeData = NavDataStore.getRoute();
            if (routeData) {
                planRoute();
            }
        } catch (e) {
            console.error('[NavCore] 加载路线数据失败:', e);
        }
    }

    /**
     * 规划路线（支持途径点的多段路线规划）
     */
    function planRoute() {
        try {
            if (!routeData || !routeData.start || !routeData.end) {
                console.error('[NavCore] 路线数据不完整');
                return;
            }

            const startPos = routeData.start.position;
            const endPos = routeData.end.position;
            const waypoints = routeData.waypoints || [];

            const syncSuccess = syncKMLLayersToGlobal();
            if (!syncSuccess) {
                console.warn('[NavCore] KML图层同步失败');
            }

            // 构建路线点序列
            const routePoints = [startPos];
            waypoints.forEach(wp => {
                if (wp && wp.position) {
                    routePoints.push(wp.position);
                }
            });
            routePoints.push(endPos);

            let path = [];

            if (typeof planKMLRoute === 'function' && syncSuccess) {
                let allSegmentsSuccess = true;

                for (let i = 0; i < routePoints.length - 1; i++) {
                    const segmentStart = routePoints[i];
                    const segmentEnd = routePoints[i + 1];

                    if (typeof resetKMLGraph === 'function') {
                        resetKMLGraph();
                    }

                    try {
                        const segmentResult = planKMLRoute(segmentStart, segmentEnd);

                        if (segmentResult && segmentResult.path && segmentResult.path.length >= 2) {
                            if (path.length > 0) {
                                for (let j = 1; j < segmentResult.path.length; j++) {
                                    path.push(segmentResult.path[j]);
                                }
                            } else {
                                path = path.concat(segmentResult.path);
                            }
                        } else {
                            if (path.length > 0) {
                                path.push(segmentEnd);
                            } else {
                                path.push(segmentStart);
                                path.push(segmentEnd);
                            }
                            allSegmentsSuccess = false;
                        }
                    } catch (e) {
                        console.error('[NavCore] 路段规划异常:', e);
                        if (path.length > 0) {
                            path.push(segmentEnd);
                        } else {
                            path.push(segmentStart);
                            path.push(segmentEnd);
                        }
                        allSegmentsSuccess = false;
                    }
                }
            }

            if (path.length < 2) {
                path = routePoints;
            }

            NavRenderer.drawRoute(path);
            NavRenderer.addRouteMarkers(startPos, endPos, routeData);

            if (waypoints.length > 0) {
                NavRenderer.addWaypointMarkers(waypoints);
            }

            navigationPath = path;

            const totalDistance = calculatePathDistance(path);
            const estimatedTime = Math.ceil(totalDistance / 8.33); // 使用8.33m/s（30km/h）计算预计时间

            if (typeof NavUI !== 'undefined' && NavUI.updateRouteInfo) {
                NavUI.updateRouteInfo({
                    distance: totalDistance,
                    time: estimatedTime
                });
            }

            const pointSet = resamplePathWithOriginalPoints(path, 3);
            window.navigationPointSet = pointSet;

            const turningPoints = detectTurningPoints(pointSet, 30);
            window.navigationTurningPoints = turningPoints;

            calculateSegmentRanges(path, waypoints);
        } catch (e) {
            console.error('[NavCore] 规划路线失败:', e);
        }
    }

    /**
     * 计算分段范围（基于途径点位置匹配）
     * @param {Array} path - 原始路径
     * @param {Array} waypoints - 途径点数组
     */
    function calculateSegmentRanges(path, waypoints) {
        segmentRanges = [];
        const pointSet = window.navigationPointSet;

        if (!pointSet || pointSet.length === 0) {
            console.error('[分段] 点集未生成');
            return;
        }

        console.log('[分段] 开始计算分段...');
        console.log('[分段] 原始路径点数:', path.length);
        console.log('[分段] 途径点数:', waypoints.length);
        console.log('[分段] 点集大小:', pointSet.length);

        // 构建分段：起点 -> 途径点1 -> 途径点2 -> ... -> 终点
        if (waypoints.length === 0) {
            // 没有途径点，只有一段
            segmentRanges.push({
                start: 0,
                end: pointSet.length - 1,
                name: '起点到终点'
            });
        } else {
            // 有途径点，通过坐标匹配找到途径点在点集中的位置
            let lastIndex = 0;

            for (let i = 0; i < waypoints.length; i++) {
                const waypoint = waypoints[i];
                const wpLng = Array.isArray(waypoint.position) ? waypoint.position[0] : waypoint.position.lng;
                const wpLat = Array.isArray(waypoint.position) ? waypoint.position[1] : waypoint.position.lat;

                console.log(`[分段] 查找途径点${i + 1}: [${wpLng}, ${wpLat}]`);

                // 在点集中查找最接近途径点的原始点
                let closestIndex = -1;
                let minDistance = Infinity;

                for (let j = lastIndex; j < pointSet.length; j++) {
                    const point = pointSet[j];
                    if (!point.isOriginal) continue; // 只检查原始路径点

                    const pos = point.position;
                    const lng = Array.isArray(pos) ? pos[0] : pos.lng;
                    const lat = Array.isArray(pos) ? pos[1] : pos.lat;

                    const dist = haversineDistance(wpLat, wpLng, lat, lng);

                    if (dist < minDistance) {
                        minDistance = dist;
                        closestIndex = j;
                    }

                    // 如果距离小于5米，认为找到了
                    if (dist < 5) {
                        break;
                    }
                }

                if (closestIndex > lastIndex) {
                    console.log(`[分段] 找到途径点${i + 1}在点集索引${closestIndex}（距离${minDistance.toFixed(2)}米）`);
                    
                    segmentRanges.push({
                        start: lastIndex,
                        end: closestIndex,
                        name: `${i === 0 ? '起点' : '途径点' + i}到途径点${i + 1}`
                    });
                    lastIndex = closestIndex;
                } else {
                    console.warn(`[分段] 未找到途径点${i + 1}的匹配点（最近距离${minDistance.toFixed(2)}米）`);
                }
            }

            // 最后一段：最后一个途径点到终点
            segmentRanges.push({
                start: lastIndex,
                end: pointSet.length - 1,
                name: `途径点${waypoints.length}到终点`
            });
        }

        console.log('[分段] 路线分段完成:', segmentRanges.length, '段');
        segmentRanges.forEach((seg, idx) => {
            const segmentLength = seg.end - seg.start + 1;
            console.log(`  段${idx}: ${seg.name}, 点索引${seg.start}-${seg.end} (${segmentLength}个点)`);
        });

        // 初始化当前段索引
        currentSegmentIndex = 0;

        // 暴露到全局供UI使用
        window.segmentRanges = segmentRanges;
        window.currentSegmentIndex = currentSegmentIndex;
    }

    /**
     * 检查段间转向（从上一段末到当前段首）
     * 只在首次吸附到段首附近（前5个点）时播报
     */
    function checkSegmentTransition() {
        try {
            const fullPointSet = window.navigationPointSet;
            const currentSegmentPointSet = window.currentSegmentPointSet;

            if (!fullPointSet || !currentSegmentPointSet || currentSegmentIndex === 0) {
                return; // 第一段没有段间转向
            }

            // 【改进】只有在首次吸附到段首附近时才播报转向
            // 如果吸附到后面的节，说明用户已经完成转向，不需要播报
            if (currentSnappedIndex > 5) {
                console.log(`[段间转向] 已吸附到第${currentSnappedIndex}个点，跳过段间转向播报`);
                return;
            }

            // 获取上一段的最后两个点
            const prevSegment = segmentRanges[currentSegmentIndex - 1];
            if (prevSegment.end < 2) return; // 上一段点不够

            const prevPrevPoint = fullPointSet[prevSegment.end - 1].position;
            const prevEndPoint = fullPointSet[prevSegment.end].position; // 途经点（既是上段终点，也是本段起点）

            // 获取当前段的前两个点
            if (currentSegmentPointSet.length < 2) return;
            const currStartPoint = currentSegmentPointSet[0].position; // 途经点
            const currNextPoint = currentSegmentPointSet[1].position;

            // 计算段间转向角
            const bearingIn = calculateBearing(prevPrevPoint, prevEndPoint);  // 上一段进入途经点的方向
            const bearingOut = calculateBearing(currStartPoint, currNextPoint); // 当前段离开途经点的方向

            let turnAngle = bearingOut - bearingIn;
            if (turnAngle > 180) turnAngle -= 360;
            if (turnAngle < -180) turnAngle += 360;

            const absTurnAngle = Math.abs(turnAngle);
            const turnType = getTurnType(turnAngle);

            console.log(`[段间转向] 转向角: ${turnAngle.toFixed(1)}°, 类型: ${turnType}, 当前吸附索引: ${currentSnappedIndex}`);

            // 如果转向角度 >= 30度，播报转向指令
            if (absTurnAngle >= 30) {
                const action = getTurnActionText(turnType);
                console.log(`[段间转向] 播报: ${action}`);
                NavTTS.speak(`请${action}`, { force: true });
            } else {
                console.log(`[段间转向] 角度较小，继续直行`);
            }
        } catch (e) {
            console.error('[段间转向] 检测失败:', e);
        }
    }

    /**
     * 检查是否完成当前路段并切换到下一段
     * @param {number} currentIndex - 当前点索引（段内相对索引）
     * @param {Array} gpsPosition - GPS原始位置 [lng, lat]
     * @returns {boolean} 是否切换了路段或完成导航
     */
    function checkSegmentCompletion(currentIndex, gpsPosition) {
        const pointSet = window.currentSegmentPointSet;

        if (!pointSet || pointSet.length === 0) {
            return false;
        }

        // 获取段末点（途径点或终点）位置
        const endPoint = pointSet[pointSet.length - 1].position;
        const endLng = Array.isArray(endPoint) ? endPoint[0] : endPoint.lng;
        const endLat = Array.isArray(endPoint) ? endPoint[1] : endPoint.lat;

        // 判断到达条件：
        // 1. 点集索引到达最后1-2个点
        // 2. 或GPS实际位置距离途径点/终点 ≤ 3米
        const isNearEnd = currentIndex >= pointSet.length - 3; // 最后2个点范围

        let actualDistance = Infinity;
        if (gpsPosition) {
            actualDistance = haversineDistance(
                gpsPosition[1], gpsPosition[0],
                endLat, endLng
            );
        }

        const isWithin3Meters = actualDistance <= 3;

        // 任一条件满足即判定到达
        if (isNearEnd || isWithin3Meters) {
            console.log(`[分段] 完成路段${currentSegmentIndex}: ${segmentRanges[currentSegmentIndex].name} (点集索引:${currentIndex}/${pointSet.length-1}, 实际距离:${actualDistance.toFixed(2)}米)`);

            // 降低已完成路段的层级
            NavRenderer.lowerCompletedSegmentZIndex();

            // 检查是否还有下一段
            if (currentSegmentIndex < segmentRanges.length - 1) {
                // 设置段间过渡标志
                isInSegmentTransition = true;

                // 播报到达途径点
                const currentSegmentName = segmentRanges[currentSegmentIndex].name;
                const waypointName = currentSegmentName.split('到')[1]; // 提取途径点名称
                NavTTS.speak(`已到达${waypointName}`, { force: true });

                // 切换到下一段
                currentSegmentIndex++;
                const nextSegment = segmentRanges[currentSegmentIndex];
                console.log(`[分段] 开始路段${currentSegmentIndex}: ${nextSegment.name}`);

                // 更新全局变量
                window.currentSegmentIndex = currentSegmentIndex;

                // 重置吸附索引和导航提示状态
                currentSnappedIndex = -1;
                lastSnappedIndex = -1;
                lastTurningPointIndex = -1;
                nextTurningPointIndex = -1;
                hasPrompted1_4 = false;
                hasPromptedBefore = false;

                // 显示下一段的绿色路线（会重新计算转向点）
                showCurrentSegmentRoute();

                // 【改进】不再使用固定1.5秒延迟，而是在首次吸附后检测段间转向
                // 段间转向检测会在 onGPSUpdate 中首次吸附成功后触发
                isInSegmentTransition = true;  // 标记为段间过渡中

                return true;
            } else {
                // 所有路段已完成，导航结束
                console.log('[分段] 所有路段已完成，导航结束');
                completeNavigation();
                return true;
            }
        }

        return false;
    }

    /**
     * 计算路径总距离
     * @param {Array} path - 路径点数组 [[lng,lat], ...]
     * @returns {number} 距离（米）
     */
    function calculatePathDistance(path) {
        if (!path || path.length < 2) return 0;

        let totalDistance = 0;
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];

            const lng1 = Array.isArray(p1) ? p1[0] : p1.lng;
            const lat1 = Array.isArray(p1) ? p1[1] : p1.lat;
            const lng2 = Array.isArray(p2) ? p2[0] : p2.lng;
            const lat2 = Array.isArray(p2) ? p2[1] : p2.lat;

            totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
        }

        return totalDistance;
    }

    /**
     * Haversine公式计算两点距离
     * @returns {number} 距离（米）
     */
    function haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // 地球半径（米）
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * 重采样路径：在原始点之间按3米间隔插点
     * @param {Array} originalPath - 原始路径 [[lng, lat], ...]
     * @param {number} interval - 插点间隔（米），默认3米
     * @returns {Array} 点集数组
     */
    function resamplePathWithOriginalPoints(originalPath, interval = 3) {
        if (!originalPath || originalPath.length < 2) return [];

        const pointSet = [];
        let totalDistance = 0;

        // 添加起点
        pointSet.push({
            position: originalPath[0],
            index: 0,
            distance: 0,
            isOriginal: true,
            originalIndex: 0
        });

        for (let i = 0; i < originalPath.length - 1; i++) {
            const start = originalPath[i];
            const end = originalPath[i + 1];

            const lng1 = Array.isArray(start) ? start[0] : start.lng;
            const lat1 = Array.isArray(start) ? start[1] : start.lat;
            const lng2 = Array.isArray(end) ? end[0] : end.lng;
            const lat2 = Array.isArray(end) ? end[1] : end.lat;

            const segmentDist = haversineDistance(lat1, lng1, lat2, lng2);

            if (segmentDist >= interval) {
                // 这段够长，插入等间距点
                const numPoints = Math.floor(segmentDist / interval);

                for (let j = 1; j <= numPoints; j++) {
                    const ratio = (j * interval) / segmentDist;
                    const interpLng = lng1 + (lng2 - lng1) * ratio;
                    const interpLat = lat1 + (lat2 - lat1) * ratio;

                    totalDistance += interval;
                    pointSet.push({
                        position: [interpLng, interpLat],
                        index: pointSet.length,
                        distance: totalDistance,
                        isOriginal: false,
                        originalIndex: null
                    });
                }

                // 更新累计距离（插值点到原始点end的剩余距离）
                const remainingDist = segmentDist - (numPoints * interval);
                totalDistance += remainingDist;
            } else {
                // 这段不足3米，直接累加距离
                totalDistance += segmentDist;
            }

            // 添加原始路径点（除了最后一个点，后面单独加）
            if (i < originalPath.length - 2) {
                pointSet.push({
                    position: [lng2, lat2],
                    index: pointSet.length,
                    distance: totalDistance,
                    isOriginal: true,
                    originalIndex: i + 1
                });
            }
        }

        // 添加终点
        const lastPoint = originalPath[originalPath.length - 1];
        const lastLng = Array.isArray(lastPoint) ? lastPoint[0] : lastPoint.lng;
        const lastLat = Array.isArray(lastPoint) ? lastPoint[1] : lastPoint.lat;

        pointSet.push({
            position: [lastLng, lastLat],
            index: pointSet.length,
            distance: totalDistance,
            isOriginal: true,
            originalIndex: originalPath.length - 1
        });

        console.log(`[重采样] 原始${originalPath.length}个点 → 点集${pointSet.length}个点`);
        return pointSet;
    }

    /**
     * 检测转向点（相邻点检测法，包含段首和段末）
     * @param {Array} pointSet - 重采样后的点集
     * @param {number} angleThreshold - 角度阈值（度），默认30度
     * @returns {Array} 转向点数组
     */
    function detectTurningPoints(pointSet, angleThreshold = 30) {
        const turningPoints = [];

        if (!pointSet || pointSet.length < 2) {
            return turningPoints;
        }

        for (let i = 0; i < pointSet.length; i++) {
            let prev, curr, next;
            let bearingIn, bearingOut;
            let turnAngle;

            if (i === 0) {
                // 段首起点：检测是否需要立即转向/掉头
                // 使用：前一段的最后方向 vs 当前段的第一段方向
                // 但在当前段点集中，无法获取前一段信息，所以这里跳过
                // 段首转向检测由段切换逻辑处理（checkSegmentCompletion中）
                continue;

            } else if (i === pointSet.length - 1) {
                // 段末终点：检测从倒数第二个点到终点的转向
                if (i < 1) continue;
                prev = pointSet[i - 1].position;
                curr = pointSet[i].position;

                // 如果有下一段，需要检测终点的转向（用于段末掉头提示）
                // 但这里只能检测段内转向，段间转向由段切换逻辑处理
                // 所以这里先检测倒数第二个点到终点是否有转向
                if (i >= 2) {
                    // 有足够的点，可以计算终点转向
                    const prevPrev = pointSet[i - 2].position;
                    bearingIn = calculateBearing(prevPrev, prev);
                    bearingOut = calculateBearing(prev, curr);

                    turnAngle = bearingOut - bearingIn;
                    if (turnAngle > 180) turnAngle -= 360;
                    if (turnAngle < -180) turnAngle += 360;

                    if (Math.abs(turnAngle) >= angleThreshold) {
                        turningPoints.push({
                            pointIndex: i,
                            position: curr,
                            turnAngle: turnAngle,
                            turnType: getTurnType(turnAngle),
                            isOriginalPoint: pointSet[i].isOriginal,
                            bearingAfterTurn: bearingOut,
                            isSegmentEnd: true  // 标记为段末转向点
                        });
                    }
                }
                continue;

            } else {
                // 中间点：正常检测
                prev = pointSet[i - 1].position;
                curr = pointSet[i].position;
                next = pointSet[i + 1].position;

                bearingIn = calculateBearing(prev, curr);
                bearingOut = calculateBearing(curr, next);

                turnAngle = bearingOut - bearingIn;
                if (turnAngle > 180) turnAngle -= 360;
                if (turnAngle < -180) turnAngle += 360;

                if (Math.abs(turnAngle) >= angleThreshold) {
                    turningPoints.push({
                        pointIndex: i,
                        position: curr,
                        turnAngle: turnAngle,
                        turnType: getTurnType(turnAngle),
                        isOriginalPoint: pointSet[i].isOriginal,
                        bearingAfterTurn: bearingOut
                    });
                }
            }
        }

        // 过滤掉"抵消转向"（S型小弯）
        return filterCancelingTurns(turningPoints, pointSet);
    }

    /**
     * 过滤掉相互抵消的转向点（S型小弯）
     * @param {Array} turningPoints - 转向点数组
     * @param {Array} pointSet - 点集
     * @returns {Array} 过滤后的转向点数组
     */
    function filterCancelingTurns(turningPoints, pointSet) {
        if (!turningPoints || turningPoints.length < 2) {
            return turningPoints;
        }

        const filtered = [];
        let i = 0;

        while (i < turningPoints.length) {
            const current = turningPoints[i];

            // 检查是否有下一个转向点
            if (i < turningPoints.length - 1) {
                const next = turningPoints[i + 1];

                // 计算两个转向点之间的路径距离（沿着点集走）
                let pathDistance = 0;
                for (let j = current.pointIndex; j < next.pointIndex && j < pointSet.length - 1; j++) {
                    const p1 = pointSet[j].position;
                    const p2 = pointSet[j + 1].position;
                    pathDistance += haversineDistance(p1[1], p1[0], p2[1], p2[0]);
                }

                // 判断是否为抵消转向（S型小弯）
                const isCanceling =
                    pathDistance <= 2 &&  // 路径距离 ≤ 2米
                    ((current.turnAngle > 0 && next.turnAngle < 0) ||  // 转向相反（左右或右左）
                     (current.turnAngle < 0 && next.turnAngle > 0)) &&
                    Math.abs(Math.abs(current.turnAngle) - Math.abs(next.turnAngle)) <= 10;  // 角度接近抵消（误差≤10度）

                if (isCanceling) {
                    // 再次确认：检查转向前后的总体方向变化
                    // 如果是真正的S弯，前后方向应该基本一致
                    // 扩大检查范围：向前向后各看2-3个点
                    const beforeIdx = Math.max(0, current.pointIndex - 3);
                    const afterIdx = Math.min(pointSet.length - 1, next.pointIndex + 3);

                    if (beforeIdx < current.pointIndex && afterIdx > next.pointIndex) {
                        const beforePos = pointSet[beforeIdx].position;
                        const afterPos = pointSet[afterIdx].position;

                        // 计算整体方向变化（跨越S弯前后的方向）
                        const bearingBefore = calculateBearing(beforePos, pointSet[current.pointIndex].position);
                        const bearingAfter = calculateBearing(pointSet[next.pointIndex].position, afterPos);

                        let directionChange = bearingAfter - bearingBefore;
                        if (directionChange > 180) directionChange -= 360;
                        if (directionChange < -180) directionChange += 360;

                        // 如果前后方向变化 ≤ 15度，确认是S弯，跳过这两个转向点
                        if (Math.abs(directionChange) <= 15) {
                            console.log(`[转向点过滤] 跳过S型小弯：点${current.pointIndex}(${current.turnAngle.toFixed(1)}°)和点${next.pointIndex}(${next.turnAngle.toFixed(1)}°)，路径距离${pathDistance.toFixed(2)}米，方向变化${directionChange.toFixed(1)}°`);
                            i += 2;  // 跳过这两个点
                            continue;
                        }
                    }
                }
            }

            // 保留当前转向点
            filtered.push(current);
            i++;
        }

        if (filtered.length < turningPoints.length) {
            console.log(`[转向点过滤] 原始${turningPoints.length}个转向点 → 过滤后${filtered.length}个转向点`);
        }

        return filtered;
    }

    /**
     * 计算方位角（0-360度，正北为0）
     */
    function calculateBearing(from, to) {
        const lng1 = Array.isArray(from) ? from[0] : from.lng;
        const lat1 = Array.isArray(from) ? from[1] : from.lat;
        const lng2 = Array.isArray(to) ? to[0] : to.lng;
        const lat2 = Array.isArray(to) ? to[1] : to.lat;

        const dLng = (lng2 - lng1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;

        const y = Math.sin(dLng) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        bearing = (bearing + 360) % 360; // 归一化到0-360

        return bearing;
    }

    /**
     * 根据转向角度判断转向类型
     */
    function getTurnType(angle) {
        const absAngle = Math.abs(angle);

        if (absAngle >= 150) {
            return 'uturn';
        } else if (angle < -30) {
            return 'left';
        } else if (angle > 30) {
            return 'right';
        } else {
            return 'straight';
        }
    }

    /**
     * 显示当前路段的绿色路线
     */
    function showCurrentSegmentRoute() {
        try {
            if (segmentRanges.length === 0 || currentSegmentIndex >= segmentRanges.length) {
                console.error('[分段显示] 无有效路段');
                return;
            }

            const segment = segmentRanges[currentSegmentIndex];
            const pointSet = window.navigationPointSet;

            if (!pointSet || pointSet.length === 0) {
                console.error('[分段显示] 点集未生成');
                return;
            }

            const segmentPath = [];
            for (let i = segment.start; i <= segment.end; i++) {
                if (i < pointSet.length) {
                    segmentPath.push(pointSet[i].position);
                }
            }

            if (segmentPath.length < 2) {
                console.error('[分段显示] 当前段路径点不足');
                return;
            }

            NavRenderer.drawRoute(segmentPath);
            generateSegmentPointSet(segment);
        } catch (e) {
            console.error('[分段显示] 显示当前路段失败:', e);
        }
    }

    /**
     * 为当前路段生成独立的点集和重新计算转向点
     * @param {Object} segment - 路段信息 {start, end, name}
     */
    function generateSegmentPointSet(segment) {
        try {
            const fullPointSet = window.navigationPointSet;

            if (!fullPointSet) return;

            // 提取当前段的点集
            const segmentPointSet = [];
            for (let i = segment.start; i <= segment.end; i++) {
                if (i < fullPointSet.length) {
                    const point = fullPointSet[i];
                    segmentPointSet.push({
                        position: point.position,
                        index: segmentPointSet.length, // 重新索引（从0开始）
                        globalIndex: i, // 保存全局索引
                        distance: point.distance,
                        isOriginal: point.isOriginal,
                        originalIndex: point.originalIndex
                    });
                }
            }

            // 保存当前段的点集（用于吸附）
            window.currentSegmentPointSet = segmentPointSet;

            // 重新计算当前段的转向点（避免筛选漏点）
            const segmentTurningPoints = detectTurningPoints(segmentPointSet, 30);
            window.currentSegmentTurningPoints = segmentTurningPoints;

            console.log(`[分段点集] 当前段点集: ${segmentPointSet.length}个点, 转向点: ${segmentTurningPoints.length}个（重新计算）`);
        } catch (e) {
            console.error('[分段点集] 生成失败:', e);
        }
    }

    /**
     * 开始导航
     */
    async function startNavigation() {
        try {
            if (isNavigating) {
                console.warn('[NavCore] 导航已在进行中');
                return false;
            }

            if (!routeData || navigationPath.length < 2) {
                alert('请先规划路线');
                return false;
            }

            console.log('[NavCore] 正在获取当前位置...');

            // 直接获取当前GPS位置（会自动触发权限请求）
            const currentPosition = await getCurrentGPSPosition();
            if (!currentPosition) {
                console.error('[NavCore] 无法获取当前位置，导航启动失败');
                return false;
            }

            console.log('[NavCore] 当前位置已获取:', currentPosition);

            // 绘制从当前位置到起点的蓝色指引线
            drawGuidanceToStart(currentPosition);

            console.log('[NavCore] 开始导航...');

            isNavigating = true;
            hasReachedStart = false;  // 重置到达起点状态
            window.hasReachedStart = false;  // 同步到全局
            window.hasAnnouncedNavigationStart = false;  // 重置播报标志

            // 隐藏主地图的selfMarker（避免与导航系统的userMarker冲突）
            if (typeof window.selfMarker !== 'undefined' && window.selfMarker) {
                window.selfMarker.hide();
                console.log('[NavCore] 已隐藏主地图的selfMarker');
            }

            // 隐藏完整路线，只显示第一段
            showCurrentSegmentRoute();

            // 更新底部目的地信息
            updateDestinationInfo();

            // 启动GPS监听
            NavGPS.startWatch(onGPSUpdate, onGPSError);

            // 启动定时更新
            startUpdateTimer();

            // 注意：语音提示已在 drawGuidanceToStart() 中根据距离判断播报
            // 不在这里重复播报

            console.log('[NavCore] ✓ 导航已启动');
            return true;
        } catch (e) {
            console.error('[NavCore] 启动导航失败:', e);
            isNavigating = false;
            return false;
        }
    }

    /**
     * 获取当前GPS位置（Promise方式，快速获取）
     * @returns {Promise<Array|null>} [lng, lat] 或 null
     */
    function getCurrentGPSPosition() {
        return new Promise((resolve) => {
            if (!('geolocation' in navigator)) {
                console.error('[NavCore] 浏览器不支持定位');
                resolve(null);
                return;
            }

            // 先尝试快速获取（使用缓存位置，5秒超时）
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    let lng = position.coords.longitude;
                    let lat = position.coords.latitude;

                    // 坐标转换
                    const converted = NavGPS.convertCoordinates(lng, lat);
                    console.log('[NavCore] GPS位置获取成功:', converted);
                    resolve(converted);
                },
                (error) => {
                    console.error('[NavCore] 快速获取GPS位置失败:', error);

                    // 如果快速获取失败，尝试高精度获取（10秒超时）
                    if (error.code === error.TIMEOUT) {
                        console.log('[NavCore] 尝试高精度定位...');
                        navigator.geolocation.getCurrentPosition(
                            (position) => {
                                let lng = position.coords.longitude;
                                let lat = position.coords.latitude;
                                const converted = NavGPS.convertCoordinates(lng, lat);
                                console.log('[NavCore] 高精度GPS位置获取成功:', converted);
                                resolve(converted);
                            },
                            (error2) => {
                                console.error('[NavCore] 高精度获取GPS位置失败:', error2);
                                handleGPSError(error2);
                                resolve(null);
                            },
                            {
                                enableHighAccuracy: true,
                                timeout: 10000,  // 10秒超时
                                maximumAge: 0
                            }
                        );
                    } else {
                        handleGPSError(error);
                        resolve(null);
                    }
                },
                {
                    enableHighAccuracy: false,  // 先不用高精度，快速获取
                    timeout: 5000,  // 5秒超时
                    maximumAge: 10000  // 允许使用10秒内的缓存位置
                }
            );
        });
    }

    /**
     * 处理GPS错误
     * @param {GeolocationPositionError} error
     */
    function handleGPSError(error) {
        if (error.code === error.PERMISSION_DENIED) {
            alert('定位权限被拒绝');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            alert('位置信息不可用，请检查GPS是否开启');
        } else if (error.code === error.TIMEOUT) {
            alert('获取位置超时，请移动到空旷位置或稍后重试');
        }
    }

    /**
     * 绘制从当前位置到起点的蓝色指引线
     * @param {Array} currentPos - [lng, lat]
     */
    function drawGuidanceToStart(currentPos) {
        try {
            if (!routeData || !routeData.start) return;

            const startPos = routeData.start.position;

            // 计算距离
            const distance = NavGPS.calculateDistance(currentPos, startPos);

            console.log(`[NavCore] 当前位置距起点: ${distance.toFixed(1)}米`);

            // 创建用户位置标记（到达起点前显示"我的位置"图标）
            NavRenderer.updateUserMarker(currentPos, 0, false, false);

            // 如果距离超过20米，绘制蓝色引导线并提示
            if (distance > 20) {
                NavRenderer.drawGuidanceLine(currentPos, startPos);
                console.log('[NavCore] 已绘制蓝色指引线');

                // 更新上方提示栏：显示"请前往起点"
                if (typeof NavUI !== 'undefined' && NavUI.updateNavigationTip) {
                    const distanceText = distance < 1000
                        ? `${Math.round(distance)}米`
                        : `${(distance / 1000).toFixed(1)}公里`;

                    NavUI.updateNavigationTip({
                        type: 'straight',
                        action: '前往起点',
                        distance: Math.round(distance),
                        message: `前往起点 ${distanceText}`
                    });
                }

                // 语音播报：请前往起点
                const distanceText = distance < 1000
                    ? `${Math.round(distance)}米`
                    : `${(distance / 1000).toFixed(1)}公里`;
                NavTTS.speak(`距离起点${distanceText}，请先前往起点`, { force: true });
            } else {
                console.log('[NavCore] 已在起点附近，无需绘制指引线');

                // 在起点附近，播报正常的导航开始提示
                const firstSegment = segmentRanges[0];
                const targetName = firstSegment.name.split('到')[1];
                NavTTS.speak(`导航已开始，前往${targetName}`, { force: true });
            }
        } catch (e) {
            console.error('[NavCore] 绘制指引线失败:', e);
        }
    }

    /**
     * 更新底部目的地信息（始终显示最终目的地）
     */
    function updateDestinationInfo() {
        try {
            if (!routeData) return;

            // 底部卡片始终显示最终目的地（终点）
            const targetInfo = {
                name: routeData.end.name || '终点',
                type: 'end',
                distance: 0,
                time: 0
            };

            // 计算到终点的剩余距离和时间（从当前位置到终点的所有剩余路段）
            const pointSet = window.navigationPointSet;
            if (pointSet && segmentRanges.length > 0) {
                let totalDistance = 0;
                
                // 累加当前段及后续所有段的距离
                for (let segIdx = currentSegmentIndex; segIdx < segmentRanges.length; segIdx++) {
                    const segment = segmentRanges[segIdx];
                    for (let i = segment.start; i < segment.end; i++) {
                        if (i < pointSet.length - 1) {
                            const p1 = pointSet[i].position;
                            const p2 = pointSet[i + 1].position;
                            totalDistance += NavGPS.calculateDistance(p1, p2);
                        }
                    }
                }

                targetInfo.distance = totalDistance;
                targetInfo.time = Math.ceil(totalDistance / 8.33); // 使用8.33m/s（30km/h）计算时间
            }

            // 更新UI
            NavUI.updateDestinationInfo(targetInfo);

            console.log('[NavCore] 目的地信息已更新:', targetInfo);
        } catch (e) {
            console.error('[NavCore] 更新目的地信息失败:', e);
        }
    }

    /**
     * 停止导航
     */
    function stopNavigation() {
        try {
            if (!isNavigating) {
                return;
            }

            console.log('[NavCore] 停止导航...');

            isNavigating = false;
            hasReachedStart = false;  // 重置到达起点状态
            window.hasReachedStart = false;  // 【修复】同步到全局
            window.hasAnnouncedNavigationStart = false;  // 重置播报标志

            // 停止GPS监听
            NavGPS.stopWatch();

            // 停止定时器
            stopUpdateTimer();

            // 停止语音
            NavTTS.stop();

            // 关闭路线箭头
            NavRenderer.toggleRouteArrows(false);

            // 显示KML线
            // NavRenderer.showKMLLines(); // 可选

            // 清除用户标记
            // NavRenderer.clearAll(); // 可选，根据需求
            
            // 恢复显示主地图的selfMarker
            if (typeof window.selfMarker !== 'undefined' && window.selfMarker) {
                window.selfMarker.show();
                console.log('[NavCore] 已恢复显示主地图的selfMarker');
            }

            console.log('[NavCore] ✓ 导航已停止');
        } catch (e) {
            console.error('[NavCore] 停止导航失败:', e);
        }
    }

    /**
     * 在当前段点集中查找8米范围内最近的点（只在当前节内吸附）
     * @param {Array} gpsPosition - GPS位置 [lng, lat]
     * @returns {Object|null} { index, position, distance, globalIndex }
     */
    function findNearestPointInSet(gpsPosition) {
        // 使用当前段的点集
        const pointSet = window.currentSegmentPointSet;
        const turningPoints = window.currentSegmentTurningPoints;

        if (!pointSet || pointSet.length === 0) {
            return null;
        }

        // 如果当前处于偏离状态，扩大搜索范围到整个当前段
        const isDeviated = NavRenderer.isDeviated();

        // 确定当前节的范围（两个转向点之间为一节）
        let sectionStart = 0;  // 当前节起始点索引
        let sectionEnd = pointSet.length - 1;  // 当前节结束点索引

        if (!isDeviated && turningPoints && turningPoints.length > 0) {
            // 非偏离状态：只在当前节内查找
            if (currentSnappedIndex >= 0) {
                // 找到当前吸附点所在节的范围
                let prevTurnIndex = -1;
                let nextTurnIndex = pointSet.length - 1;

                for (let i = 0; i < turningPoints.length; i++) {
                    if (turningPoints[i].pointIndex <= currentSnappedIndex) {
                        prevTurnIndex = turningPoints[i].pointIndex;
                    }
                    if (turningPoints[i].pointIndex > currentSnappedIndex && nextTurnIndex === pointSet.length - 1) {
                        nextTurnIndex = turningPoints[i].pointIndex;
                        break;
                    }
                }

                sectionStart = prevTurnIndex >= 0 ? prevTurnIndex : 0;
                sectionEnd = nextTurnIndex;

                // 【关键优化】如果接近转向点（距离转向点<8个点），扩大搜索范围到下一节
                // 这样可以避免V字急转弯和直角转弯时误判为偏离
                // 8个点 × 3米/点 = 24米的提前搜索距离
                if (nextTurnIndex < pointSet.length - 1) {
                    const distanceToTurn = nextTurnIndex - currentSnappedIndex;
                    if (distanceToTurn < 8) {
                        // 找到下下个转向点
                        for (let i = 0; i < turningPoints.length; i++) {
                            if (turningPoints[i].pointIndex > nextTurnIndex) {
                                sectionEnd = turningPoints[i].pointIndex;
                                console.log(`[点集吸附] 接近转向点(${distanceToTurn}个点)，扩大搜索到下一节: ${sectionStart} - ${sectionEnd}`);
                                break;
                            }
                        }
                    }
                }
            } else {
                // 首次吸附或段切换后：搜索整个当前段（避免段切换时定位不准）
                sectionStart = 0;
                sectionEnd = pointSet.length - 1;
            }
        } else if (isDeviated) {
            // 偏离状态：搜索整个当前段，允许往回吸附（但会在调用处判断）
            sectionStart = 0;
            sectionEnd = pointSet.length - 1;
            console.log(`[点集吸附] 偏离状态，搜索整个段: 0 - ${sectionEnd}`);
        }

        // 在指定范围内查找最近点
        let nearestIndex = -1;
        let nearestDistance = Infinity;
        let nearestPosition = null;
        let nearestGlobalIndex = -1;

        for (let i = sectionStart; i <= sectionEnd && i < pointSet.length; i++) {
            const point = pointSet[i];
            const pos = point.position;
            const lng = Array.isArray(pos) ? pos[0] : pos.lng;
            const lat = Array.isArray(pos) ? pos[1] : pos.lat;

            const distance = haversineDistance(
                gpsPosition[1], gpsPosition[0],
                lat, lng
            );

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
                nearestPosition = [lng, lat];
                nearestGlobalIndex = point.globalIndex;
            }
        }

        // 【优化】动态吸附阈值：根据场景调整（使用全局配置）
        let snapThreshold = SNAP_THRESHOLD_NORMAL; // 基础阈值（直线路段）

        // 1. 转弯处放宽阈值（GPS在转弯时误差更大）
        if (turningPoints && turningPoints.length > 0 && nearestIndex >= 0) {
            for (let i = 0; i < turningPoints.length; i++) {
                const turnPointIndex = turningPoints[i].pointIndex;
                const distanceToTurnPoint = Math.abs(nearestIndex - turnPointIndex);

                // 距离转向点±10个点（约30米）范围内，使用转弯阈值
                if (distanceToTurnPoint <= 10) {
                    snapThreshold = SNAP_THRESHOLD_TURNING;
                    console.log(`[点集吸附] 接近转向点，放宽吸附阈值到${snapThreshold}米`);
                    break;
                }
            }
        }

        // 2. 偏离状态下使用转弯阈值（帮助用户更容易回归路线）
        if (isDeviated) {
            snapThreshold = SNAP_THRESHOLD_TURNING;
            console.log(`[点集吸附] 偏离状态，放宽吸附阈值到${snapThreshold}米`);
        }

        if (nearestDistance <= snapThreshold) {
            return {
                index: nearestIndex, // 当前段内的相对索引
                globalIndex: nearestGlobalIndex, // 全局索引
                position: nearestPosition,
                distance: nearestDistance,
                crossedSection: isDeviated // 标记是否跨节接入
            };
        }

        return null;
    }

    /**
     * 计算当前的行进方向（基于当前段点集）
     * @param {number} currentIndex - 当前点索引（段内相对索引）
     * @returns {number} 方向角（0-360度，正北为0）
     */
    function calculateCurrentBearing(currentIndex) {
        const pointSet = window.currentSegmentPointSet;

        if (!pointSet || currentIndex < 0) {
            return 0;
        }

        // 如果已经到达终点，返回上一段的方向
        if (currentIndex >= pointSet.length - 1) {
            if (currentIndex >= 1) {
                const prev = pointSet[currentIndex - 1].position;
                const curr = pointSet[currentIndex].position;
                return calculateBearing(prev, curr);
            }
            return 0;
        }

        // 使用当前点到下一个点的方向
        const curr = pointSet[currentIndex].position;
        const next = pointSet[currentIndex + 1].position;
        return calculateBearing(curr, next);
    }

    /**
     * 更新导航提示（核心逻辑 - 简化版）
     * @param {number} currentIndex - 当前点索引（段内相对索引）
     */
    function updateNavigationGuidance(currentIndex) {
        try {
            const pointSet = window.currentSegmentPointSet;
            const turningPoints = window.currentSegmentTurningPoints;

            if (!pointSet || pointSet.length === 0) return;

            const now = Date.now();

            // 查找下一个转向点
            let nextTurnPoint = null;
            let nextTurnIndex = -1;

            if (turningPoints && turningPoints.length > 0) {
                for (let i = 0; i < turningPoints.length; i++) {
                    const tp = turningPoints[i];
                    if (tp.pointIndex > currentIndex) {
                        nextTurnPoint = tp;
                        nextTurnIndex = i;
                        break;
                    }
                }
            }

            if (!nextTurnPoint) {
                // 没有下一个转向点，显示直行或即将到达
                const remainingPoints = pointSet.length - currentIndex - 1;
                if (remainingPoints < 10) {
                    // 接近段末
                    updateGuidanceUI({
                        type: 'straight',
                        action: '直行',
                        distance: remainingPoints * 3, // 估算剩余距离
                        message: '继续直行'
                    });
                }
                return;
            }

            // 计算到下一个转向点的距离
            let distanceToTurn = 0;
            for (let i = currentIndex; i < nextTurnPoint.pointIndex && i < pointSet.length - 1; i++) {
                const p1 = pointSet[i].position;
                const p2 = pointSet[i + 1].position;
                distanceToTurn += haversineDistance(p1[1], p1[0], p2[1], p2[0]);
            }

            // 计算两个转向点之间的总距离
            let totalDistanceBetweenTurns = distanceToTurn;
            if (currentIndex > 0) {
                // 查找上一个转向点
                let prevTurnPointIndex = -1;
                for (let i = turningPoints.length - 1; i >= 0; i--) {
                    if (turningPoints[i].pointIndex < currentIndex) {
                        prevTurnPointIndex = turningPoints[i].pointIndex;
                        break;
                    }
                }

                if (prevTurnPointIndex >= 0) {
                    // 计算从上一个转向点到当前转向点的总距离
                    totalDistanceBetweenTurns = 0;
                    for (let i = prevTurnPointIndex; i < nextTurnPoint.pointIndex && i < pointSet.length - 1; i++) {
                        const p1 = pointSet[i].position;
                        const p2 = pointSet[i + 1].position;
                        totalDistanceBetweenTurns += haversineDistance(p1[1], p1[0], p2[1], p2[0]);
                    }
                }
            }

            // 判断两个转向点是否太近（<5米不提前播报）
            const isTooClose = totalDistanceBetweenTurns < 5;

            // 计算1/4距离
            const quarterDistance = totalDistanceBetweenTurns / 4;

            // 获取转向动作文本
            const turnAction = getTurnActionText(nextTurnPoint.turnType);

            // 提示逻辑
            if (nextTurnPoint.pointIndex !== nextTurningPointIndex) {
                // 新的转向点，重置提示状态
                nextTurningPointIndex = nextTurnPoint.pointIndex;
                hasPrompted1_4 = false;
                hasPromptedBefore = false;

                // 【转弯校验】新转向点，重置转弯阶段（可能上一个转弯未完成）
                if (isTurningPhase) {
                    console.log('[转弯校验] 检测到新转向点，重置转弯阶段状态');
                    isTurningPhase = false;
                    turningPhaseEndTime = 0;
                }
            }

            // 掉头特殊处理：到达掉头点后播报
            if (nextTurnPoint.turnType === 'uturn') {
                // 1. 到达掉头点附近（距离≤6米）：直接播报掉头
                // 修复：确保在转向点之前播报，不要等到过了转向点
                const isNearUturnPoint = (currentIndex < nextTurnPoint.pointIndex && distanceToTurn <= 6) ||
                                        (currentIndex === nextTurnPoint.pointIndex);

                if (isNearUturnPoint) {
                    if (!hasPromptedBefore) {
                        const guidance = {
                            type: nextTurnPoint.turnType,
                            action: turnAction,
                            distance: 0,
                            message: turnAction
                        };
                        updateGuidanceUI(guidance);
                        NavTTS.speak(turnAction, { force: true }); // 强制播报
                        hasPromptedBefore = true;
                        lastGuidanceTime = now;

                        // 【转弯校验】播报掉头，进入转弯阶段，设置5秒后结束
                        isTurningPhase = true;
                        turningPhaseEndTime = now + 5000;
                        console.log('[转弯校验] 播报掉头，进入转弯阶段，5秒后结束');

                        console.log(`[掉头播报] ${turnAction}, 当前索引=${currentIndex}, 掉头点索引=${nextTurnPoint.pointIndex}, 距离=${distanceToTurn.toFixed(1)}米`);
                    }
                    return;
                }

                // 2. 距离掉头点1/4距离：提前播报（除非太近）
                if (!isTooClose && distanceToTurn <= quarterDistance * 1.2 && distanceToTurn > quarterDistance * 0.8) {
                    if (!hasPrompted1_4) {
                        const guidance = {
                            type: nextTurnPoint.turnType,
                            action: turnAction,
                            distance: Math.round(distanceToTurn),
                            message: `前方准备${turnAction}`
                        };
                        updateGuidanceUI(guidance);
                        NavTTS.speak(`前方准备${turnAction}`, { force: true }); // 强制播报
                        hasPrompted1_4 = true;
                        lastGuidanceTime = now;

                        // 【转弯校验】进入转弯准备阶段（掉头）
                        isTurningPhase = true;
                        console.log('[转弯校验] 进入转弯准备阶段（掉头）');
                    }
                    return;
                }
            } else {
                // 左转/右转处理：提前播报
                // 1. 到达转向点附近（距离≤8米且在转向点之前）：直接播报转向
                // 修复：确保在转向点之前播报，距离阈值从4米增加到8米，避免车速快时错过
                const isNearTurnPoint = (currentIndex < nextTurnPoint.pointIndex && distanceToTurn <= 8) ||
                                       (currentIndex === nextTurnPoint.pointIndex - 1);

                if (isNearTurnPoint) {
                    if (!hasPromptedBefore) {
                        const guidance = {
                            type: nextTurnPoint.turnType,
                            action: turnAction,
                            distance: Math.round(distanceToTurn),
                            message: turnAction
                        };
                        updateGuidanceUI(guidance);
                        NavTTS.speak(turnAction, { force: true }); // 强制播报
                        hasPromptedBefore = true;
                        lastGuidanceTime = now;

                        // 【转弯校验】播报转弯，进入转弯阶段，设置5秒后结束
                        isTurningPhase = true;
                        turningPhaseEndTime = now + 5000;
                        console.log('[转弯校验] 播报转弯，进入转弯阶段，5秒后结束');

                        console.log(`[转向播报] ${turnAction}, 当前索引=${currentIndex}, 转向点索引=${nextTurnPoint.pointIndex}, 距离=${distanceToTurn.toFixed(1)}米`);
                    }
                    return;
                }

                // 2. 距离转向点1/4距离：提前播报（除非太近）
                if (!isTooClose && distanceToTurn <= quarterDistance * 1.2 && distanceToTurn > quarterDistance * 0.8) {
                    if (!hasPrompted1_4) {
                        const guidance = {
                            type: nextTurnPoint.turnType,
                            action: turnAction,
                            distance: Math.round(distanceToTurn),
                            message: `前方准备${turnAction}`
                        };
                        updateGuidanceUI(guidance);
                        NavTTS.speak(`前方准备${turnAction}`, { force: true }); // 强制播报
                        hasPrompted1_4 = true;
                        lastGuidanceTime = now;

                        // 【转弯校验】进入转弯准备阶段（左转/右转）
                        isTurningPhase = true;
                        console.log('[转弯校验] 进入转弯准备阶段（左转/右转）');
                    }
                    return;
                }
            }

            // 3. 默认：显示距离和方向（只更新UI，不播报）
            if (distanceToTurn > 0) {
                updateGuidanceUI({
                    type: nextTurnPoint.turnType,
                    action: turnAction,
                    distance: Math.round(distanceToTurn),
                    message: `前方准备${turnAction}`
                }, false); // 不播报

                // 尝试智能直行提示（在转向点之间的长距离路段）
                if (distanceToTurn > 50) {
                    handleStraightPrompt(currentIndex, distanceToTurn);
                }
            }

        } catch (e) {
            console.error('[导航提示] 更新失败:', e);
        }
    }

    /**
     * 更新速度计算（只计算当前段内的移动）
     * @param {Array} position - [lng, lat]
     */
    function updateSpeed(position) {
        try {
            const now = Date.now();

            // 添加到历史记录（包含当前段索引）
            gpsHistory.push({
                position: position,
                time: now,
                segmentIndex: currentSegmentIndex
            });

            // 只保留最近8个点（约8秒内），增加平滑度
            if (gpsHistory.length > 8) {
                gpsHistory.shift();
            }

            // 过滤掉不在当前段的历史点（段切换后清理）
            gpsHistory = gpsHistory.filter(h => h.segmentIndex === currentSegmentIndex);

            // 至少需要2个点才能计算速度
            if (gpsHistory.length >= 2) {
                const oldest = gpsHistory[0];
                const newest = gpsHistory[gpsHistory.length - 1];

                // 计算总距离（只计算当前段内的点）
                let totalDistance = 0;
                for (let i = 0; i < gpsHistory.length - 1; i++) {
                    const p1 = gpsHistory[i].position;
                    const p2 = gpsHistory[i + 1].position;
                    totalDistance += haversineDistance(p1[1], p1[0], p2[1], p2[0]);
                }

                // 计算时间差（秒）
                const timeDiff = (newest.time - oldest.time) / 1000;

                if (timeDiff > 0.5 && totalDistance > 0.3) { // 至少0.5秒，移动0.3米
                    const newSpeed = totalDistance / timeDiff;

                    // 平滑处理（移动平均，更平滑）
                    currentSpeed = currentSpeed * 0.8 + newSpeed * 0.2;

                    // 限制速度范围：1-20 m/s（3.6-72 km/h）
                    currentSpeed = Math.max(1, Math.min(20, currentSpeed));

                    console.log(`[速度计算] 当前速度: ${currentSpeed.toFixed(2)} m/s (${(currentSpeed * 3.6).toFixed(1)} km/h), 采样点:${gpsHistory.length}`);
                }
            }
        } catch (e) {
            console.error('[速度计算] 失败:', e);
        }
    }

    /**
     * 判断直线类型（规范直线 vs 不规范直线）
     * @param {number} currentIndex - 当前点索引
     * @param {number} lookAheadPoints - 向前检查的点数
     * @returns {string} 'regular' | 'irregular'
     */
    function checkStraightType(currentIndex, lookAheadPoints = 10) {
        try {
            const pointSet = window.currentSegmentPointSet;
            if (!pointSet || currentIndex < 0) return 'irregular';

            const endIndex = Math.min(currentIndex + lookAheadPoints, pointSet.length - 1);
            if (endIndex - currentIndex < 3) return 'irregular'; // 点太少

            // 计算连续点之间的方向角变化
            let maxAngleChange = 0;
            let totalAngleChange = 0;
            let angleCount = 0;

            for (let i = currentIndex; i < endIndex - 1; i++) {
                const p1 = pointSet[i].position;
                const p2 = pointSet[i + 1].position;
                const p3 = pointSet[i + 2].position;

                const bearing1 = calculateBearing(p1, p2);
                const bearing2 = calculateBearing(p2, p3);

                // 归一化角度差到 -180~180
                let angleDiff = bearing2 - bearing1;
                if (angleDiff > 180) angleDiff -= 360;
                if (angleDiff < -180) angleDiff += 360;

                const absAngleDiff = Math.abs(angleDiff);
                maxAngleChange = Math.max(maxAngleChange, absAngleDiff);
                totalAngleChange += absAngleDiff;
                angleCount++;
            }

            const avgAngleChange = angleCount > 0 ? totalAngleChange / angleCount : 0;

            // 判断标准：
            // 规范直线：最大角度变化<5度，平均角度变化<2度
            // 不规范直线：有明显弯曲
            if (maxAngleChange < 5 && avgAngleChange < 2) {
                return 'regular'; // 很规范的直线
            } else {
                return 'irregular'; // 不规范的直线（有弯曲）
            }
        } catch (e) {
            console.error('[直线类型判断] 失败:', e);
            return 'irregular';
        }
    }

    /**
     * 智能直行提示（确保5-6秒稳定播报）
     * @param {number} currentIndex - 当前点索引
     * @param {number} distanceToNextTurn - 到下一个转向点的距离（如果有）
     */
    function handleStraightPrompt(currentIndex, distanceToNextTurn = Infinity) {
        try {
            const now = Date.now();

            // 计算10秒后的预计位移
            const predictedDistance = currentSpeed * 10; // 10秒后移动的距离

            // 判断10秒内是否会有转向提示
            const willHaveTurnPrompt = distanceToNextTurn < predictedDistance + 15; // 提前15米缓冲

            // 如果10秒内会有转向提示，不播报直行（避免抑制转向）
            if (willHaveTurnPrompt) {
                console.log(`[直行提示] 跳过：10秒内将有转向 (距离:${distanceToNextTurn.toFixed(0)}米, 预测移动:${predictedDistance.toFixed(0)}米)`);
                return;
            }

            // 检查距离上次直行提示的时间
            const timeSinceLastPrompt = (now - lastStraightPromptTime) / 1000; // 秒

            // 计算自上次提示后移动的距离
            const movedDistance = currentSpeed * timeSinceLastPrompt;

            // 5-6秒播报频率：必须 ≥5秒 且 移动 ≥7.5米（1.5m/s * 5s）
            const minInterval = 5.0; // 最小5秒
            const minDistance = currentSpeed * minInterval; // 动态计算最小距离

            if (timeSinceLastPrompt < minInterval) {
                return; // 还不到5秒
            }

            if (movedDistance < minDistance * 0.9) { // 允许10%误差
                return; // 移动距离不够
            }

            // 判断直线类型
            const straightType = checkStraightType(currentIndex);

            // 计算前方直行距离（到下一个转向点或段末）
            const pointSet = window.currentSegmentPointSet;
            let straightDistance = 0;
            const maxCheckPoints = Math.min(20, pointSet.length - currentIndex - 1); // 最多检查20个点

            for (let i = currentIndex; i < currentIndex + maxCheckPoints && i < pointSet.length - 1; i++) {
                const p1 = pointSet[i].position;
                const p2 = pointSet[i + 1].position;
                straightDistance += haversineDistance(p1[1], p1[0], p2[1], p2[0]);

                // 限制最大播报距离
                if (straightDistance >= Math.min(distanceToNextTurn, 100)) {
                    straightDistance = Math.min(distanceToNextTurn, 100);
                    break;
                }
            }

            // 如果直行距离太短（<15米），不播报
            if (straightDistance < 15) {
                console.log(`[直行提示] 跳过：前方距离太短 (${straightDistance.toFixed(0)}米)`);
                return;
            }

            // 构建提示消息
            let message;
            let actionType;
            if (straightType === 'regular') {
                message = `继续直行`;
                actionType = 'straight-regular';
            } else {
                message = `沿当前道路继续直行`;
                actionType = 'straight-irregular';
            }

            // 避免重复播报相同内容
            if (lastPromptType === actionType && timeSinceLastPrompt < 8) {
                console.log(`[直行提示] 跳过：重复播报 (${timeSinceLastPrompt.toFixed(1)}秒前已播报)`);
                return;
            }

            // 更新UI
            updateGuidanceUI({
                type: 'straight',
                action: straightType === 'regular' ? '直行' : '沿道路行走',
                distance: Math.round(straightDistance),
                message: message
            }, false); // 不立即播报，下面单独播报

            // 语音播报
            NavTTS.speak(message, { force: false });

            // 更新播报时间和类型
            lastStraightPromptTime = now;
            lastPromptType = actionType;

            console.log(`[直行提示] ✓ ${message} (类型:${straightType}, 速度:${currentSpeed.toFixed(2)}m/s, 间隔:${timeSinceLastPrompt.toFixed(1)}秒)`);
        } catch (e) {
            console.error('[直行提示] 失败:', e);
        }
    }

    /**
     * 获取转向动作文本
     * @param {string} turnType - 转向类型（left/right/uturn/straight）
     * @returns {string}
     */
    function getTurnActionText(turnType) {
        const actions = {
            'left': '左转',
            'right': '右转',
            'uturn': '掉头',
            'straight': '直行'
        };
        return actions[turnType] || '继续前进';
    }

    /**
     * 更新导航提示UI
     * @param {Object} guidance - 提示信息 { type, action, distance, message }
     * @param {boolean} speak - 是否语音播报，默认true
     */
    function updateGuidanceUI(guidance, speak = true) {
        try {
            currentGuidance = guidance;

            // 更新上方提示栏
            if (typeof NavUI !== 'undefined' && NavUI.updateNavigationTip) {
                NavUI.updateNavigationTip(guidance);
            }

            console.log('[导航提示]', guidance.message);
        } catch (e) {
            console.error('[导航提示] 更新UI失败:', e);
        }
    }

    /**
     * 检查是否到达转向点（需要旋转地图）
     * @param {number} currentIndex - 当前点索引（段内相对索引）
     * @returns {Object|null} { needRotate: boolean, bearing: number }
     */
    function checkTurningPoint(currentIndex) {
        const turningPoints = window.currentSegmentTurningPoints;

        if (!turningPoints || currentIndex < 0) {
            return null;
        }

        // 查找下一个转向点
        let nextTurnPoint = null;
        for (let i = 0; i < turningPoints.length; i++) {
            if (turningPoints[i].pointIndex > currentIndex) {
                nextTurnPoint = turningPoints[i];
                break;
            }
        }

        if (!nextTurnPoint) {
            return null; // 没有下一个转向点
        }

        // 【关键优化】只在转向点的前一个点触发旋转
        if (currentIndex === nextTurnPoint.pointIndex - 1 &&
            nextTurnPoint.pointIndex !== lastTurningPointIndex) {

            // 标记已处理此转向点
            lastTurningPointIndex = nextTurnPoint.pointIndex;

            // 使用预计算的方位角
            const newBearing = nextTurnPoint.bearingAfterTurn;

            console.log(`[转向点] 到达转向点前一个点(索引${currentIndex}), 转向类型: ${nextTurnPoint.turnType}, 预计算方位角: ${newBearing.toFixed(1)}°`);

            return {
                needRotate: true,
                bearing: newBearing,  // ← 使用预计算的方位角
                turnType: nextTurnPoint.turnType,
                turnAngle: nextTurnPoint.turnAngle
            };
        }

        return null;
    }

    /**
     * 检查道路是否竖直（接近南北走向）
     * @param {number} bearing - 道路方位角（0-360度）
     * @param {number} threshold - 竖直判定阈值，默认15度
     * @returns {boolean} 是否竖直
     */
    function isRoadVertical(bearing, threshold = 15) {
        if (bearing === null || bearing === undefined || isNaN(bearing)) {
            return false;
        }

        // 归一化到0-360
        const normalizedBearing = ((bearing % 360) + 360) % 360;

        // 计算与正北（0°）或正南（180°）的最小偏差
        const deviationFromNorth = Math.min(
            Math.abs(normalizedBearing - 0),
            Math.abs(normalizedBearing - 360)
        );
        const deviationFromSouth = Math.abs(normalizedBearing - 180);
        const minDeviation = Math.min(deviationFromNorth, deviationFromSouth);

        return minDeviation <= threshold;
    }



    // 实时校验相关状态
    let forceSecondaryCheck = false;     // 是否强制立即执行校验（偏离回归后）
    let lastAlignedBearing = null;       // 上次对齐的道路方向（用于平滑过渡）

    /**
     * 实时道路对齐校验：确保道路始终竖直显示，图标0度与道路对齐
     * 每次GPS更新都执行，用"前一个点→后一个点"的连线方向实时校正地图旋转
     * @param {Array} position - 当前位置 [lng, lat]
     * @param {number} currentIndex - 当前吸附点索引
     */
    function secondaryVerticalCheck(position, currentIndex) {
        try {
            const now = Date.now();

            // 检查转弯阶段是否已结束
            if (isTurningPhase && turningPhaseEndTime > 0 && now > turningPhaseEndTime) {
                isTurningPhase = false;
                turningPhaseEndTime = 0;
                console.log('[实时对齐] 转弯阶段已结束');
            }

            const turningPoints = window.currentSegmentTurningPoints;
            const pointSet = window.currentSegmentPointSet;
            const map = NavRenderer.getMap();

            if (!pointSet || !map || currentIndex < 0 || currentIndex >= pointSet.length - 1) {
                return;
            }

            // 重置强制校验标志
            if (forceSecondaryCheck) {
                console.log('[实时对齐] 偏离回归后立即执行校验');
                forceSecondaryCheck = false;
            }

            // 获取当前地图旋转角度（弧度），转换为度
            const mapRotationRad = map.getRotation() || 0;
            const mapRotation = mapRotationRad * 180 / Math.PI;

            // 计算局部道路方向：前一个点→后一个点的连线
            // 这样更精准地反映当前位置的道路方向
            const prevIndex = Math.max(0, currentIndex - 1);
            const nextIndex = Math.min(pointSet.length - 1, currentIndex + 1);

            // 如果前后点相同（边界情况），跳过校验
            if (prevIndex === nextIndex) return;

            const localBearing = calculateBearing(
                pointSet[prevIndex].position,
                pointSet[nextIndex].position
            );

            // 计算道路在屏幕上的显示角度
            // 地图旋转后，道路的屏幕角度 = 道路真实方向 - 地图旋转角度
            let screenAngle = localBearing - mapRotation;
            screenAngle = ((screenAngle % 360) + 360) % 360;

            // 检查是否接近竖直（0°或180°表示屏幕上竖直）
            const deviationFromNorth = Math.min(
                Math.abs(screenAngle),
                Math.abs(screenAngle - 360)
            );
            const deviationFromSouth = Math.abs(screenAngle - 180);
            const deviationFromVertical = Math.min(deviationFromNorth, deviationFromSouth);

            // 【核心改动】降低阈值到5度，确保道路始终精准竖直
            // 这样图标保持0度就能和道路完美对齐
            const alignmentThreshold = 5;

            if (deviationFromVertical > alignmentThreshold) {
                // 目标：让道路竖直显示（屏幕角度为0或180）
                // 需要调整地图旋转角度，使 screenAngle = localBearing - mapRotation = 0 或 180
                // 因此：mapRotation = localBearing 或 localBearing - 180

                // 选择更接近当前旋转角度的目标（避免大幅度旋转）
                const targetRotation1 = localBearing;
                const targetRotation2 = localBearing - 180;

                // 归一化到 -180 ~ 180
                const normalize = (angle) => {
                    angle = angle % 360;
                    if (angle > 180) angle -= 360;
                    if (angle < -180) angle += 360;
                    return angle;
                };

                const normalizedTarget1 = normalize(targetRotation1);
                const normalizedTarget2 = normalize(targetRotation2);
                const normalizedCurrent = normalize(mapRotation);

                const diff1 = Math.abs(normalize(normalizedTarget1 - normalizedCurrent));
                const diff2 = Math.abs(normalize(normalizedTarget2 - normalizedCurrent));

                const targetBearing = diff1 <= diff2 ? normalizedTarget1 : normalizedTarget2;

                // 平滑过渡：只在偏差较小且变化极小时跳过，避免抖动
                if (lastAlignedBearing !== null && deviationFromVertical < alignmentThreshold * 1.5) {
                    const bearingChange = Math.abs(normalize(targetBearing - lastAlignedBearing));
                    if (bearingChange < 1) {
                        return; // 已经接近对齐且变化极小，跳过
                    }
                }

                console.log(`[实时对齐] 道路方向=${localBearing.toFixed(1)}°, 地图旋转=${mapRotation.toFixed(1)}°, 屏幕角度=${screenAngle.toFixed(1)}°, 偏差=${deviationFromVertical.toFixed(1)}°, 校正到=${targetBearing.toFixed(1)}°`);

                // 执行校正：setHeadingUpMode会将地图旋转到指定角度
                NavRenderer.setHeadingUpMode(position, targetBearing, true);
                lastAlignedBearing = targetBearing;
            }
        } catch (e) {
            console.error('[实时对齐] 执行失败:', e);
        }
    }

    /**
     * 启动偏离快速检测（1.5秒一次）
     * 在可能偏离的3秒防抖期间，加快GPS检测频率
     */
    function startDeviationFastCheck() {
        // 如果已经有定时器在运行，先清除
        if (deviationCheckIntervalId !== null) {
            clearInterval(deviationCheckIntervalId);
        }

        console.log('[偏离检测] 启动GPS加速检测（1.5秒/次）');

        deviationCheckIntervalId = setInterval(() => {
            // 主动触发一次GPS位置获取
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lng = pos.coords.longitude;
                    const lat = pos.coords.latitude;
                    const accuracy = pos.coords.accuracy || 10;
                    const heading = pos.coords.heading || 0;

                    // 坐标转换
                    const converted = NavGPS.convertCoordinates(lng, lat);

                    console.log('[偏离检测] 快速检测GPS更新:', converted, `精度:${accuracy}米`);

                    // 手动触发吸附检测（复用主逻辑）
                    const snapped = findNearestPointInSet(converted);

                    if (snapped) {
                        // 吸附成功，说明是GPS漂移！
                        console.log('[偏离检测] ✓ GPS已回归，判定为漂移，停止加速检测');
                        stopDeviationFastCheck();

                        // 重置偏离计时器
                        deviationStartTime = 0;

                        // 触发正常的GPS更新流程
                        onGPSUpdate(converted, accuracy, heading);
                    }
                },
                (error) => {
                    console.warn('[偏离检测] GPS快速检测失败:', error.message);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0
                }
            );
        }, 1500); // 1.5秒一次
    }

    /**
     * 停止偏离快速检测，恢复正常频率
     */
    function stopDeviationFastCheck() {
        if (deviationCheckIntervalId !== null) {
            clearInterval(deviationCheckIntervalId);
            deviationCheckIntervalId = null;
            console.log('[偏离检测] 停止GPS加速检测，恢复正常频率');
        }
    }

    /**
     * 将GPS位置吸附到KML路网上（用于偏离轨迹显示）
     * @param {Array} position - GPS位置 [lng, lat]
     * @returns {Array|null} 吸附后的位置 [lng, lat]，如果无法吸附则返回null
     */
    function snapToKMLNetwork(position) {
        try {
            // 检查是否有KML路线吸附功能
            if (typeof findNearestKMLSegment !== 'function') {
                return null;
            }

            // 查找最近的KML线段
            const nearest = findNearestKMLSegment(position);
            
            if (!nearest || !nearest.projectionPoint) {
                return null;
            }

            // 检查距离是否在吸附范围内（使用常规吸附阈值）
            if (nearest.distance > SNAP_THRESHOLD_NORMAL) {
                console.log(`[偏离吸附] 距离KML路网${nearest.distance.toFixed(1)}米，超出吸附范围${SNAP_THRESHOLD_NORMAL}米`);
                return null;
            }

            // 返回投影点位置
            const projPoint = nearest.projectionPoint;
            const snappedPos = [projPoint.lng, projPoint.lat];
            
            console.log(`[偏离吸附] 吸附到KML路网，距离${nearest.distance.toFixed(1)}米`);
            return snappedPos;
        } catch (e) {
            console.error('[偏离吸附] 执行失败:', e);
            return null;
        }
    }

    /**
     * 检测当前位置是否在KML其他路线上，如果是则重新规划到当前段终点
     * @param {Array} position - 当前GPS位置 [lng, lat]
     * @returns {boolean} 是否成功重新规划
     */
    function checkAndReplanFromKML(position) {
        try {
            // 检查是否有KML路线规划功能
            if (typeof planKMLRoute !== 'function' || typeof resetKMLGraph !== 'function') {
                console.log('[偏航重规划] KML路线规划功能不可用');
                return false;
            }

            // 获取当前段的终点
            const currentSegment = segmentRanges[currentSegmentIndex];
            if (!currentSegment) {
                console.log('[偏航重规划] 无法获取当前段信息');
                return false;
            }

            const fullPointSet = window.navigationPointSet;
            if (!fullPointSet || fullPointSet.length === 0) {
                console.log('[偏航重规划] 点集不存在');
                return false;
            }

            // 获取当前段终点位置
            const segmentEndPoint = fullPointSet[currentSegment.end];
            if (!segmentEndPoint) {
                console.log('[偏航重规划] 无法获取段终点');
                return false;
            }

            const endPos = segmentEndPoint.position;
            const endLng = Array.isArray(endPos) ? endPos[0] : endPos.lng;
            const endLat = Array.isArray(endPos) ? endPos[1] : endPos.lat;

            console.log('[偏航重规划] 尝试从当前位置重新规划到段终点:', {
                当前位置: position,
                段终点: [endLng, endLat],
                当前段: currentSegmentIndex,
                段名称: currentSegment.name
            });

            // 重置KML图，准备重新规划
            resetKMLGraph();

            // 尝试规划新路线
            const newRoute = planKMLRoute(position, [endLng, endLat]);

            if (!newRoute || !newRoute.path || newRoute.path.length < 2) {
                console.log('[偏航重规划] 无法规划新路线（可能不在KML路网上）');
                return false;
            }

            console.log('[偏航重规划] 新路线规划成功:', {
                路径点数: newRoute.path.length,
                总距离: newRoute.distance ? newRoute.distance.toFixed(1) + '米' : '未知'
            });

            // 更新当前段的路线
            const newPath = newRoute.path;

            // 重新生成点集（只更新当前段）
            const newPointSet = resamplePathWithOriginalPoints(newPath, 3);
            window.currentSegmentPointSet = newPointSet.map((point, idx) => ({
                ...point,
                index: idx,
                globalIndex: currentSegment.start + idx
            }));

            // 重新计算转向点
            const newTurningPoints = detectTurningPoints(window.currentSegmentPointSet, 30);
            window.currentSegmentTurningPoints = newTurningPoints;

            console.log('[偏航重规划] 新点集生成:', {
                点数: window.currentSegmentPointSet.length,
                转向点数: newTurningPoints.length
            });

            // 重新绘制路线
            NavRenderer.drawRoute(newPath);

            // 重置吸附状态
            currentSnappedIndex = 0;
            lastSnappedIndex = -1;
            lastTurningPointIndex = -1;
            nextTurningPointIndex = -1;
            hasPrompted1_4 = false;
            hasPromptedBefore = false;

            // 更新用户位置到新路线起点
            NavRenderer.updateUserMarker(position, 0, false, true);
            NavRenderer.setLastSnappedPosition(newPointSet[0].position);

            // 居中地图并对齐道路
            if (newPointSet.length >= 2) {
                const bearing = calculateBearing(newPointSet[0].position, newPointSet[1].position);
                NavRenderer.setHeadingUpMode(position, bearing, true);
            }

            return true;
        } catch (e) {
            console.error('[偏航重规划] 执行失败:', e);
            return false;
        }
    }

    /**
     * GPS位置更新回调
     * @param {Array} position - [lng, lat]
     * @param {number} accuracy - 精度（米）
     * @param {number} gpsHeading - GPS方向（度）
     */
    function onGPSUpdate(position, accuracy, gpsHeading = 0) {
        try {
            if (!isNavigating) return;

            // 0. 更新速度计算
            updateSpeed(position);

            // 1. 尝试吸附到当前段点集
            const snapped = findNearestPointInSet(position);

            // 2. 判断是否到达起点（只有吸附成功才算到达）
            if (!hasReachedStart && snapped !== null) {
                // 第一次吸附到路网，说明到达起点
                hasReachedStart = true;
                window.hasReachedStart = true;

                // 【新增】记录导航开始时间
                navigationStartTime = Date.now();
                totalTravelDistance = 0;  // 重置总距离
                console.log('[NavCore] 导航开始时间记录:', new Date(navigationStartTime).toLocaleTimeString());

                // 清除引导线
                NavRenderer.clearGuideLine();

                // 初始化最后吸附位置（用于偏离轨迹起点）
                NavRenderer.setLastSnappedPosition(snapped.position);

                // 播报"已到达起点"
                if (!window.hasAnnouncedNavigationStart) {
                    window.hasAnnouncedNavigationStart = true;
                    const firstSegment = segmentRanges[0];
                    const targetName = firstSegment.name.split('到')[1];
                    NavTTS.speak(`已到达起点，前往${targetName}`, { force: true });
                    console.log('[NavCore] ✓ 已到达起点，开始正式导航');
                }
            }

            // 3. 处理未到达起点的情况（绘制蓝色引导线）
            if (!hasReachedStart) {
                const startPos = routeData.start.position;
                const distanceToStart = haversineDistance(
                    position[1], position[0],
                    startPos[1], startPos[0]
                );

                // 计算稳定朝向：优先设备方向；否则使用与上一点的方位角；小于0.5m不更新
                let headingForMarker = deviceHeading;
                if (headingForMarker === null || headingForMarker === undefined) {
                    if (lastPreStartPosition) {
                        const moveDist = haversineDistance(lastPreStartPosition[1], lastPreStartPosition[0], position[1], position[0]);
                        if (moveDist >= 0.5) {
                            headingForMarker = calculateBearing(lastPreStartPosition, position);
                        } else {
                            headingForMarker = lastRawHeading; // 保持上次
                        }
                    }
                }
                if (headingForMarker === null || headingForMarker === undefined || isNaN(headingForMarker)) {
                    headingForMarker = lastRawHeading || 0;
                }
                lastRawHeading = headingForMarker;
                lastPreStartPosition = position;

                // 自动校准一次（防180°反向）
                attemptAutoCalibrationPreStart(position, headingForMarker);
                // 应用偏移与地图旋转，得到最终角度
                const finalAngleRaw = getAdjustedAngle(headingForMarker);
                // EMA 平滑
                const finalAngle = smoothAngleEMA(lastSmoothedAngle, finalAngleRaw);
                lastSmoothedAngle = finalAngle;
                // 更新用户位置标记（使用稳定朝向）
                NavRenderer.updateUserMarker(position, finalAngle, false, false);

                // 实时绘制引导线
                NavRenderer.drawGuidanceLine(position, startPos);

                // 保存距离到全局变量
                window.distanceToStart = distanceToStart;

                // 更新上方提示栏：显示"前往起点"
                if (typeof NavUI !== 'undefined' && NavUI.updateNavigationTip) {
                    const distanceText = distanceToStart < 1000
                        ? `${Math.round(distanceToStart)}米`
                        : `${(distanceToStart / 1000).toFixed(1)}公里`;

                    NavUI.updateNavigationTip({
                        type: 'straight',
                        action: '前往起点',
                        distance: Math.round(distanceToStart),
                        message: `前往起点 ${distanceText}`
                    });
                }

                // 地图跟随用户位置
                NavRenderer.setCenterOnly(position, true);

                // 更新精度圈
                NavRenderer.updateAccuracyCircle(position, accuracy);

                // 未到达起点，后续逻辑不执行
                return;
            }

            // 4. 已到达起点，处理正常导航逻辑
            let displayPosition = position; // 默认显示GPS原始位置
            let displayHeading = gpsHeading; // 默认显示GPS方向

            if (snapped) {
                // ========== 吸附成功 ==========

                // 【重置偏离防抖计时器】
                if (deviationStartTime !== 0) {
                    console.log('[点集吸附] 重新吸附成功，重置偏离计时器');
                    deviationStartTime = 0;
                    hasAnnouncedDeviation = false; // 重置偏离播报标志
                    // 停止GPS加速检测
                    stopDeviationFastCheck();
                }

                // 检查是否从偏离状态恢复
                if (NavRenderer.isDeviated()) {
                    // 判断是否跨节接入（偏离后接入到不同的节）
                    const crossedSection = snapped.crossedSection || false;
                    const isSameSegment = true; // 当前逻辑下，吸附成功必然是当前段
                    const deviationInfo = NavRenderer.endDeviation(snapped.position, isSameSegment);

                    if (deviationInfo) {
                        console.log('[NavCore] 偏离后重新接入路网:',
                            `偏离前索引=${currentSnappedIndex}`,
                            `接入索引=${snapped.index}`,
                            crossedSection ? '(跨节接入)' : '(同节接入)',
                            isSameSegment ? '(同一路段)' : '(不同路段)');

                        // 【关键修复】确保接入点不能比偏离前的点还靠前
                        // 如果接入点索引小于当前索引，说明吸附逻辑有误，强制使用接入点
                        if (snapped.index < currentSnappedIndex) {
                            console.warn(`[NavCore] 警告：接入点索引(${snapped.index})小于偏离前索引(${currentSnappedIndex})，这不应该发生！`);
                        }

                        // 无论如何，都要重置转向点提示状态（因为可能跨过了转向点）
                        lastTurningPointIndex = -1;
                        hasPrompted1_4 = false;
                        hasPromptedBefore = false;
                        console.log('[NavCore] 偏离后重新接入，已重置转向点提示状态');

                        // 设置强制校验标志，偏离回归后立即执行实时对齐
                        forceSecondaryCheck = true;

                        // 播报"已回到规划路线"
                        NavTTS.speak('已回到规划路线', { force: false });
                    }
                }

                // 使用吸附位置
                displayPosition = snapped.position;
                snappedPosition = snapped.position;

                // 更新最后吸附位置（用于下次偏离的起点）
                NavRenderer.setLastSnappedPosition(snapped.position);

                // 更新吸附索引（使用段内相对索引）
                lastSnappedIndex = currentSnappedIndex;
                currentSnappedIndex = snapped.index;

                // 【新增】累计行程距离（只有前进时才累计）
                if (hasReachedStart && lastSnappedIndex >= 0 && currentSnappedIndex > lastSnappedIndex) {
                    // 计算从上一个点到当前点的距离
                    const pointSet = window.currentSegmentPointSet;
                    if (pointSet && lastSnappedIndex < pointSet.length && currentSnappedIndex < pointSet.length) {
                        const prevPos = pointSet[lastSnappedIndex].position;
                        const currPos = pointSet[currentSnappedIndex].position;
                        const stepDistance = haversineDistance(
                            prevPos[1], prevPos[0],
                            currPos[1], currPos[0]
                        );
                        totalTravelDistance += stepDistance;
                        console.log(`[统计] 行程累计: +${stepDistance.toFixed(1)}米, 总计${totalTravelDistance.toFixed(1)}米`);
                    }
                }

                // 暴露到全局供UI使用
                window.currentSnappedIndex = currentSnappedIndex;

                console.log(`[点集吸附] 吸附到段内点${snapped.index}（全局${snapped.globalIndex}）, 距离${snapped.distance.toFixed(2)}米`);

                // 【新增】段间过渡时，首次吸附成功后立即检测段间转向
                if (isInSegmentTransition && lastSnappedIndex === -1) {
                    console.log('[段间转向] 首次吸附成功，立即检测段间转向');
                    checkSegmentTransition();
                    isInSegmentTransition = false;
                }

                // 检查是否完成当前路段（到达段末）
                const segmentCompleted = checkSegmentCompletion(currentSnappedIndex, position);

                if (!segmentCompleted) {
                    // 更新导航提示（只在段内更新，段间切换时不更新）
                    updateNavigationGuidance(currentSnappedIndex);
                }

                // 更新已走路线（灰色）
                NavRenderer.updatePassedRoute(currentSnappedIndex, displayPosition);

               // 计算路网方向：从当前吸附位置到下一个转向点的方向
                const pointSet = window.currentSegmentPointSet;
                const turningPoints = window.currentSegmentTurningPoints;

                // 找到下一个转向点（基于当前吸附点，查找绿色路线上的下一个转向点）
                let nextTurnPointIndex = pointSet.length - 1; // 默认段末
                if (turningPoints && turningPoints.length > 0) {
                    for (let i = 0; i < turningPoints.length; i++) {
                        // 查找当前吸附点之后的第一个转向点
                        if (turningPoints[i].pointIndex > currentSnappedIndex) {
                            nextTurnPointIndex = turningPoints[i].pointIndex;
                            console.log(`[下一个转向点] 索引=${nextTurnPointIndex}, 类型=${turningPoints[i].turnType}, 当前吸附点=${currentSnappedIndex}`);
                            break;
                        }
                    }
                }

                // 计算从当前吸附位置到下一个转向点的方向
                const currentPos = pointSet[currentSnappedIndex].position;
                const nextTurnPos = pointSet[nextTurnPointIndex].position;
                const roadBearing = calculateBearing(currentPos, nextTurnPos);

                // 获取地图当前旋转角度
                const map = NavRenderer.getMap();
                const mapRotation = map && typeof map.getRotation === 'function' 
                    ? (map.getRotation() || 0) 
                    : 0;

                // 车辆图标始终保持0度（朝上），通过实时校正地图旋转让道路竖直
                // 这样图标0度就自然和道路方向对齐
                displayHeading = 0;

                // 【关键优化】检查是否到达转向点的前一个点
                const turningCheck = checkTurningPoint(currentSnappedIndex);
                if (turningCheck && turningCheck.needRotate) {
                    // 到达转向点前一个点，旋转地图并记录角度
                    currentMapRotation = turningCheck.bearing;
                    NavRenderer.setHeadingUpMode(displayPosition, turningCheck.bearing, true);
                } else {
                    // 【优化】直行时只移动中心，不旋转地图
                    NavRenderer.setCenterOnly(displayPosition, true);
                }

                // 【实时对齐】用"前一个点→后一个点"的方向校正地图旋转
                // 确保道路始终竖直显示，图标0度与道路对齐
                secondaryVerticalCheck(displayPosition, currentSnappedIndex);
            } else {
                // ========== 未吸附到路网（偏离路线超过8米）==========
                const now = Date.now();

                // 【防抖机制】首次检测到偏离时记录时间，持续3秒才真正进入偏离状态
                if (deviationStartTime === 0) {
                    deviationStartTime = now;
                    console.log('[点集吸附] 检测到可能偏离（超出阈值），开始3秒防抖检测...');

                    // 【GPS加速】启动1.5秒一次的快速检测，判断是漂移还是真偏离
                    startDeviationFastCheck();

                    // 即使可能偏离，也继续显示在最后吸附位置，不要立即跳到GPS位置
                    displayPosition = NavRenderer.getLastSnappedPosition() || position;
                    displayHeading = calculateCurrentBearing(currentSnappedIndex);

                    // 地图跟随最后吸附位置
                    NavRenderer.setCenterOnly(displayPosition, true);
                    return; // 直接返回，不进入偏离状态
                }

                const deviationDuration = (now - deviationStartTime) / 1000; // 秒

                // 持续3秒仍未吸附，确认为真正偏离
                if (deviationDuration < 3.0) {
                    console.log(`[点集吸附] 偏离持续 ${deviationDuration.toFixed(1)}秒，继续等待...`);
                    // 继续显示在最后吸附位置
                    displayPosition = NavRenderer.getLastSnappedPosition() || position;
                    displayHeading = calculateCurrentBearing(currentSnappedIndex);
                    NavRenderer.setCenterOnly(displayPosition, true);
                    return;
                }

                console.log('[点集吸附] 确认偏离（持续3秒未回归）');

                // 停止GPS加速检测（已确认为真偏离，不需要继续加速检测）
                stopDeviationFastCheck();

                // 【偏航重新规划】只在确认偏离后持续检测是否在KML其他路线上
                // 只有真正进入偏离状态后才尝试重新规划
                let replanResult = false;
                if (NavRenderer.isDeviated()) {
                    replanResult = checkAndReplanFromKML(position);
                    if (replanResult) {
                        console.log('[偏航重规划] 成功从KML其他路线重新规划');
                        // 重新规划成功，重置偏离状态
                        deviationStartTime = 0;
                        hasAnnouncedDeviation = false;
                        NavRenderer.endDeviation(position, true);

                        // 播报重新规划
                        NavTTS.speak('已重新规划路线', { force: true });

                        // 更新显示位置
                        displayPosition = position;
                        displayHeading = 0;

                        // 重新规划成功，后续正常更新标记
                    }
                }

                if (!replanResult) {
                    // 未能重新规划，继续偏离状态
                    // 获取最后吸附位置作为偏离起点
                    const lastSnappedPos = NavRenderer.getLastSnappedPosition();

                    if (lastSnappedPos) {
                        // 启动偏离轨迹（如果尚未启动）
                        if (!NavRenderer.isDeviated()) {
                            NavRenderer.startDeviation(lastSnappedPos);
                            console.log('[NavCore] 开始偏离轨迹，起点:', lastSnappedPos);
                            
                            // 首次进入偏离状态时播报
                            if (!hasAnnouncedDeviation) {
                                NavTTS.speak('您已偏离规划路线', { force: true });
                                hasAnnouncedDeviation = true;
                            }
                        }

                        // 【偏离轨迹吸附】尝试将GPS位置吸附到KML路网上
                        const snappedDeviationPos = snapToKMLNetwork(position);
                        const deviationDisplayPos = snappedDeviationPos || position;
                        
                        // 更新偏离轨迹（使用吸附后的位置绘制黄色线）
                        NavRenderer.updateDeviationLine(deviationDisplayPos);
                        
                        // 显示位置（优先使用吸附位置）
                        displayPosition = deviationDisplayPos;
                        displayHeading = gpsHeading;
                    } else {
                        // 没有最后吸附位置，使用GPS原始位置
                        displayPosition = position;
                        displayHeading = gpsHeading;
                    }

                    // 地图跟随显示位置移动
                    NavRenderer.setCenterOnly(displayPosition, true);

                    // 更新导航提示：提示偏离路线
                    if (typeof NavUI !== 'undefined' && NavUI.updateNavigationTip) {
                        NavUI.updateNavigationTip({
                            type: 'deviation',
                            action: '偏离路线',
                            distance: 0,
                            message: '您已偏离规划路线'
                        });
                    }
                }
            }

            // 5. 更新用户位置标记（已到达起点后）
            NavRenderer.updateUserMarker(displayPosition, displayHeading, true, true);

            // 6. 更新精度圈（始终使用GPS原始位置）
            NavRenderer.updateAccuracyCircle(position, accuracy);

        } catch (e) {
            console.error('[NavCore] GPS更新处理失败:', e);
        }
    }

    /**
     * GPS错误回调
     * @param {Error} error
     */
    function onGPSError(error) {
        console.error('[NavCore] GPS错误:', error);
        // 可以在UI上显示错误提示
    }

    /**
     * 完成导航
     */
    function completeNavigation() {
        try {
            console.log('[NavCore] 导航完成！');

            // 计算导航统计数据
            const navigationEndTime = Date.now();
            const totalTime = navigationStartTime ? (navigationEndTime - navigationStartTime) / 1000 : 0; // 秒

            console.log('[NavCore] 导航统计:');
            console.log(`  总行程: ${totalTravelDistance.toFixed(1)}米`);
            console.log(`  总时间: ${Math.ceil(totalTime)}秒 (${Math.ceil(totalTime/60)}分钟)`);

            stopNavigation();

            // 语音提示
            NavTTS.speak('您已到达目的地，导航结束', { force: true });

            // 显示完成弹窗（传递统计数据）
            if (typeof NavUI !== 'undefined' && NavUI.showNavigationCompleteModal) {
                NavUI.showNavigationCompleteModal({
                    distance: totalTravelDistance,  // 米
                    time: totalTime  // 秒
                });
            }
        } catch (e) {
            console.error('[NavCore] 完成导航失败:', e);
        }
    }

    /**
     * 启动定时更新
     */
    function startUpdateTimer() {
        if (updateTimer) return;

        updateTimer = setInterval(() => {
            if (!isNavigating) {
                stopUpdateTimer();
                return;
            }

            // 定期更新UI（如剩余时间等）
            // 暂时留空，后续UI模块可能需要
        }, 1000); // 每秒更新
    }

    /**
     * 停止定时更新
     */
    function stopUpdateTimer() {
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    }

    /**
     * 获取导航状态
     * @returns {Object}
     */
    function getStatus() {
        return {
            isNavigating: isNavigating,
            hasRoute: navigationPath.length > 0,
            pathLength: navigationPath.length,
            currentTarget: NavGuidance.getCurrentTarget(),
            gpsStatus: NavGPS.getStatus(),
            ttsStatus: NavTTS.getStatus()
        };
    }

    /**
     * 清理资源
     */
    function cleanup() {
        try {
            stopNavigation();
            NavRenderer.destroy();
            NavGPS.stopWatch();
            NavTTS.stop();

            isNavigating = false;
            navigationPath = [];
            routeData = null;

            console.log('[NavCore] 资源已清理');
        } catch (e) {
            console.error('[NavCore] 清理资源失败:', e);
        }
    }

    /**
     * 获取当前速度
     * @returns {number} 当前速度（m/s）
     */
    function getCurrentSpeed() {
        return currentSpeed;
    }

    // 公开API
    return {
        init,
        startNavigation,
        stopNavigation,
        getStatus,
        cleanup,
        getRouteData: () => routeData,
        getNavigationPath: () => navigationPath,
        getCurrentSpeed
    };
})();

window.NavCore = NavCore;
