/**
 * nav-guidance.js
 * 导航提示模块
 * 负责转向计算、路径投影、到达判定、语音提示生成
 */

const NavGuidance = (function() {
    'use strict';

    // 转向序列（预计算）
    let turnSequence = [];
    let turnSeqPtr = 0;

    // 途经点索引映射
    let waypointIndexMap = [];
    let visitedWaypoints = new Set();

    // 当前目标点
    let currentTarget = null;

    // 配置参数
    let config = {
        turnAngleThreshold: 28,           // 转向角度阈值（度）
        minSegmentLength: 1.5,            // 最小路段长度（米）
        uturnAngleThreshold: 150,         // 掉头角度阈值（度）
        straightAngleThreshold: 30,       // 直行角度阈值（度）
        arrivalThresholdEnd: 3,           // 到达终点阈值（米）
        arrivalThresholdWaypoint: 8,      // 到达途经点阈值（米）
        uturnPromptDistance: 100,         // 掉头提示距离（米）
        waypointUturnTrigger: 50          // 途经点掉头触发距离（米）
    };

    /**
     * 初始化导航提示模块
     * @param {Object} options - 配置选项
     */
    function init(options = {}) {
        try {
            console.log('[NavGuidance] 初始化导航提示模块...');

            // 从 MapConfig 读取配置
            if (typeof MapConfig !== 'undefined' && MapConfig && MapConfig.navigationConfig) {
                const navConfig = MapConfig.navigationConfig;

                if (typeof navConfig.endArrivalDistanceMeters === 'number') {
                    config.arrivalThresholdEnd = navConfig.endArrivalDistanceMeters;
                }
                if (typeof navConfig.uturnPromptDistanceMeters === 'number') {
                    config.uturnPromptDistance = navConfig.uturnPromptDistanceMeters;
                }
                if (typeof navConfig.waypointUturnTriggerMeters === 'number') {
                    config.waypointUturnTrigger = navConfig.waypointUturnTriggerMeters;
                }
            }

            // 合并用户配置
            Object.assign(config, options);

            console.log('[NavGuidance] 配置:', config);
            return true;
        } catch (e) {
            console.error('[NavGuidance] 初始化失败:', e);
            return false;
        }
    }

    /**
     * 构建转向序列（预计算）
     * @param {Array} path - 路径点数组
     * @returns {Array} 转向序列
     */
    function buildTurnSequence(path) {
        try {
            if (!path || path.length < 3) {
                return [];
            }

            const sequence = [];
            const minLen = config.minSegmentLength;

            // 遍历路径，查找转向点
            for (let i = 1; i < path.length - 1; i++) {
                const prev = path[i - 1];
                const curr = path[i];
                const next = path[i + 1];

                // 计算转向角度
                const angle = calculateTurnAngle(prev, curr, next);

                // 检查路段长度（过滤太短的路段）
                const dist1 = calculateDistance(prev, curr);
                const dist2 = calculateDistance(curr, next);

                if (dist1 < minLen || dist2 < minLen) {
                    continue; // 跳过太短的路段
                }

                // 判断转向类型
                let type = 'straight';
                if (Math.abs(angle) > config.uturnAngleThreshold) {
                    type = 'uturn';
                } else if (angle > config.straightAngleThreshold) {
                    type = 'right';
                } else if (angle < -config.straightAngleThreshold) {
                    type = 'left';
                }

                if (type !== 'straight') {
                    sequence.push({
                        index: i,
                        angle: angle,
                        type: type
                    });
                }
            }

            console.log('[NavGuidance] 转向序列已构建，包含', sequence.length, '个转向点');
            return sequence;
        } catch (e) {
            console.error('[NavGuidance] 构建转向序列失败:', e);
            return [];
        }
    }

    /**
     * 计算转向角度
     * @param {Array} p1 - 前一点
     * @param {Array} p2 - 当前点
     * @param {Array} p3 - 下一点
     * @returns {number} 转向角度（度，左负右正）
     */
    function calculateTurnAngle(p1, p2, p3) {
        try {
            const [lng1, lat1] = normalizeLngLat(p1);
            const [lng2, lat2] = normalizeLngLat(p2);
            const [lng3, lat3] = normalizeLngLat(p3);

            // 计算两个向量的角度
            const angle1 = Math.atan2(lat2 - lat1, lng2 - lng1);
            const angle2 = Math.atan2(lat3 - lat2, lng3 - lng2);

            // 计算转向角度（-180 到 180）
            let turn = (angle2 - angle1) * 180 / Math.PI;

            // 归一化到 -180 到 180
            while (turn > 180) turn -= 360;
            while (turn < -180) turn += 360;

            return turn;
        } catch (e) {
            console.error('[NavGuidance] 计算转向角度失败:', e);
            return 0;
        }
    }

    /**
     * 投影点到路径
     * @param {Array} point - 当前点 [lng, lat]
     * @param {Array} path - 路径数组
     * @returns {Object|null} { index, projection: [lng, lat], distance }
     */
    function projectPointToPath(point, path) {
        try {
            if (!point || !path || path.length < 2) {
                return null;
            }

            let minDist = Infinity;
            let bestIndex = 0;
            let bestProjection = null;

            // 遍历路径的每一段
            for (let i = 0; i < path.length - 1; i++) {
                const segStart = normalizeLngLat(path[i]);
                const segEnd = normalizeLngLat(path[i + 1]);

                // 投影到线段
                const proj = projectPointToSegment(point, segStart, segEnd);
                const dist = calculateDistance(point, proj.projection);

                if (dist < minDist) {
                    minDist = dist;
                    bestIndex = i;
                    bestProjection = proj.projection;
                }
            }

            return {
                index: bestIndex,
                projection: bestProjection,
                distance: minDist
            };
        } catch (e) {
            console.error('[NavGuidance] 投影点到路径失败:', e);
            return null;
        }
    }

    /**
     * 投影点到线段
     * @param {Array} point - 点
     * @param {Array} segStart - 线段起点
     * @param {Array} segEnd - 线段终点
     * @returns {Object} { projection, t }
     */
    function projectPointToSegment(point, segStart, segEnd) {
        try {
            const [px, py] = normalizeLngLat(point);
            const [x1, y1] = normalizeLngLat(segStart);
            const [x2, y2] = normalizeLngLat(segEnd);

            const dx = x2 - x1;
            const dy = y2 - y1;
            const lenSq = dx * dx + dy * dy;

            if (lenSq === 0) {
                // 线段退化为点
                return { projection: [x1, y1], t: 0 };
            }

            // 计算投影参数 t
            let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t)); // 限制在 [0, 1]

            // 计算投影点
            const projX = x1 + t * dx;
            const projY = y1 + t * dy;

            return {
                projection: [projX, projY],
                t: t
            };
        } catch (e) {
            console.error('[NavGuidance] 投影点到线段失败:', e);
            return { projection: point, t: 0 };
        }
    }

    /**
     * 计算沿路网到指定索引的距离
     * @param {Array} currentPos - 当前位置
     * @param {Array} path - 路径
     * @param {number} targetIndex - 目标索引
     * @returns {number} 距离（米）
     */
    function computeDistanceToIndex(currentPos, path, targetIndex) {
        try {
            if (!path || path.length === 0 || targetIndex < 0) {
                return 0;
            }

            // 投影当前位置到路径
            const proj = projectPointToPath(currentPos, path);
            if (!proj) return 0;

            let distance = 0;
            const startIdx = proj.index;

            // 从投影点到当前段的终点
            distance += calculateDistance(proj.projection, normalizeLngLat(path[startIdx + 1]));

            // 累加中间段
            for (let i = startIdx + 1; i < Math.min(targetIndex, path.length - 1); i++) {
                distance += calculateDistance(
                    normalizeLngLat(path[i]),
                    normalizeLngLat(path[i + 1])
                );
            }

            return distance;
        } catch (e) {
            console.error('[NavGuidance] 计算距离到索引失败:', e);
            return 0;
        }
    }

    /**
     * 构建途经点索引映射
     * @param {Array} path - 路径
     * @param {Array} waypoints - 途经点数组
     * @returns {Array} 途经点映射
     */
    function buildWaypointIndexMap(path, waypoints) {
        try {
            if (!path || !waypoints || waypoints.length === 0) {
                return [];
            }

            const map = [];

            waypoints.forEach(wp => {
                const pos = resolvePosition(wp);
                if (!pos) return;

                // 找到途经点在路径中的最近索引
                let minDist = Infinity;
                let bestIndex = -1;

                for (let i = 0; i < path.length; i++) {
                    const dist = calculateDistance(pos, normalizeLngLat(path[i]));
                    if (dist < minDist) {
                        minDist = dist;
                        bestIndex = i;
                    }
                }

                if (bestIndex >= 0) {
                    map.push({
                        name: wp.name || '途径点',
                        position: pos,
                        index: bestIndex
                    });
                }
            });

            console.log('[NavGuidance] 途经点索引映射已构建，数量:', map.length);
            return map;
        } catch (e) {
            console.error('[NavGuidance] 构建途经点索引映射失败:', e);
            return [];
        }
    }

    /**
     * 初始化当前目标点
     * @param {Object} routeData - 路线数据
     */
    function initializeTarget(routeData) {
        if (!routeData) return;

        currentTarget = {
            type: 'start',
            name: routeData.start?.name || '起点',
            position: routeData.start?.position || [0, 0]
        };

        console.log('[NavGuidance] 初始化目标点:', currentTarget.name);
    }

    /**
     * 切换到下一个目标点
     * @param {Object} routeData - 路线数据
     */
    function switchToNextTarget(routeData) {
        if (!routeData || !currentTarget) return;

        const currentType = currentTarget.type;

        if (currentType === 'start') {
            // 从起点切换到第一个途经点或终点
            if (waypointIndexMap.length > 0) {
                const nextWaypoint = waypointIndexMap.find(wp => !visitedWaypoints.has(wp.name));
                if (nextWaypoint) {
                    currentTarget = {
                        type: 'waypoint',
                        name: nextWaypoint.name,
                        position: nextWaypoint.position,
                        index: nextWaypoint.index
                    };
                    console.log('[NavGuidance] 切换到途经点:', currentTarget.name);
                    return;
                }
            }
            // 没有途经点，直接切换到终点
            currentTarget = {
                type: 'end',
                name: routeData.end?.name || '终点',
                position: routeData.end?.position || [0, 0]
            };
            console.log('[NavGuidance] 切换到终点:', currentTarget.name);

        } else if (currentType === 'waypoint') {
            // 从途经点切换到下一个途经点或终点
            const nextWaypoint = waypointIndexMap.find(wp => !visitedWaypoints.has(wp.name));
            if (nextWaypoint) {
                currentTarget = {
                    type: 'waypoint',
                    name: nextWaypoint.name,
                    position: nextWaypoint.position,
                    index: nextWaypoint.index
                };
                console.log('[NavGuidance] 切换到下一个途经点:', currentTarget.name);
            } else {
                // 没有更多途经点，切换到终点
                currentTarget = {
                    type: 'end',
                    name: routeData.end?.name || '终点',
                    position: routeData.end?.position || [0, 0]
                };
                console.log('[NavGuidance] 切换到终点:', currentTarget.name);
            }
        }
    }

    /**
     * 检查是否到达当前目标点
     * @param {Array} currentPos - 当前位置
     * @param {Array} path - 路径
     * @returns {boolean} 是否到达
     */
    function checkArrival(currentPos, path) {
        try {
            if (!currentTarget || !currentPos || !path) {
                return false;
            }

            const targetPos = currentTarget.position;
            const distance = calculateDistance(currentPos, targetPos);

            let threshold = config.arrivalThresholdEnd;
            if (currentTarget.type === 'waypoint') {
                threshold = config.arrivalThresholdWaypoint;
            }

            if (distance <= threshold) {
                console.log('[NavGuidance] 已到达:', currentTarget.name, '距离:', distance.toFixed(2), '米');

                // 如果是途经点，标记为已访问
                if (currentTarget.type === 'waypoint') {
                    visitedWaypoints.add(currentTarget.name);
                }

                return true;
            }

            return false;
        } catch (e) {
            console.error('[NavGuidance] 检查到达失败:', e);
            return false;
        }
    }

    /**
     * 获取导航提示
     * @param {Array} currentPos - 当前位置
     * @param {Array} path - 路径
     * @returns {Object} { type, distance, message }
     */
    function getGuidance(currentPos, path) {
        try {
            if (!path || path.length < 2) {
                return { type: 'straight', distance: 0, message: '继续直行' };
            }

            // 使用预计算的转向序列
            if (turnSequence.length > 0 && turnSeqPtr < turnSequence.length) {
                const nextTurn = turnSequence[turnSeqPtr];
                const distance = computeDistanceToIndex(currentPos, path, nextTurn.index);

                const type = nextTurn.type;
                const message = generateMessage(type, distance);

                return { type, distance, message };
            }

            // 回退：没有转向点，直行
            return { type: 'straight', distance: 0, message: '继续直行' };
        } catch (e) {
            console.error('[NavGuidance] 获取导航提示失败:', e);
            return { type: 'straight', distance: 0, message: '继续直行' };
        }
    }

    /**
     * 生成语音提示消息
     * @param {string} type - 转向类型
     * @param {number} distance - 距离（米）
     * @returns {string}
     */
    function generateMessage(type, distance) {
        const d = Math.round(distance);

        if (type === 'left') {
            if (d <= 5) return '请左转';
            if (d <= 10) return '请左转';
            if (d <= 20) return '前方准备左转';
            return '继续前进，准备左转';
        }

        if (type === 'right') {
            if (d <= 5) return '请右转';
            if (d <= 10) return '请右转';
            if (d <= 20) return '前方准备右转';
            return '继续前进，准备右转';
        }

        if (type === 'uturn') {
            if (d <= 5) return '请掉头';
            if (d <= 10) return '请掉头';
            if (d <= 20) return '前方准备掉头';
            return '继续前进，准备掉头';
        }

        return '继续直行';
    }

    /**
     * 更新转向指针（通过转向点后前进）
     * @param {Array} currentPos - 当前位置
     * @param {Array} path - 路径
     */
    function updateTurnPointer(currentPos, path) {
        try {
            if (turnSequence.length === 0 || turnSeqPtr >= turnSequence.length) {
                return;
            }

            const nextTurn = turnSequence[turnSeqPtr];
            const distance = computeDistanceToIndex(currentPos, path, nextTurn.index);

            // 如果已经通过转向点（距离很小或为负），前进指针
            if (distance < 5) {
                turnSeqPtr++;
                console.log('[NavGuidance] 通过转向点，指针前进到:', turnSeqPtr);
            }
        } catch (e) {
            console.error('[NavGuidance] 更新转向指针失败:', e);
        }
    }

    /**
     * 重置导航提示状态
     */
    function reset() {
        turnSequence = [];
        turnSeqPtr = 0;
        waypointIndexMap = [];
        visitedWaypoints.clear();
        currentTarget = null;
        console.log('[NavGuidance] 导航提示状态已重置');
    }

    // ========== 工具函数 ==========

    function calculateDistance(pos1, pos2) {
        try {
            if (typeof AMap !== 'undefined' && AMap.GeometryUtil) {
                return AMap.GeometryUtil.distance(pos1, pos2);
            }

            // Haversine公式
            const [lng1, lat1] = normalizeLngLat(pos1);
            const [lng2, lat2] = normalizeLngLat(pos2);
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                     Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        } catch (e) {
            return 0;
        }
    }

    function normalizeLngLat(point) {
        if (Array.isArray(point)) return point;
        if (point.lng !== undefined && point.lat !== undefined) return [point.lng, point.lat];
        return [0, 0];
    }

    function resolvePosition(point) {
        if (!point) return null;
        if (Array.isArray(point)) return point;
        if (point.position && Array.isArray(point.position)) return point.position;
        return null;
    }

    // 公开API
    return {
        init,
        buildTurnSequence,
        buildWaypointIndexMap,
        projectPointToPath,
        computeDistanceToIndex,
        initializeTarget,
        switchToNextTarget,
        checkArrival,
        getGuidance,
        updateTurnPointer,
        reset,

        // 状态访问
        getTurnSequence: () => turnSequence,
        getTurnPointer: () => turnSeqPtr,
        getWaypointIndexMap: () => waypointIndexMap,
        getVisitedWaypoints: () => visitedWaypoints,
        getCurrentTarget: () => currentTarget,

        // 状态设置
        setTurnSequence: (seq) => { turnSequence = seq; },
        setTurnPointer: (ptr) => { turnSeqPtr = ptr; },
        setWaypointIndexMap: (map) => { waypointIndexMap = map; },
        setCurrentTarget: (target) => { currentTarget = target; }
    };
})();

// 导出到全局
window.NavGuidance = NavGuidance;
