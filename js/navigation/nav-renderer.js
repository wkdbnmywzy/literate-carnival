/**
 * nav-renderer.js
 * 地图渲染模块
 * 负责地图初始化、路线绘制、标记管理、KML显示
 */

const NavRenderer = (function() {
    'use strict';

    // 地图实例
    let map = null;

    // 地图覆盖物
    let routePolyline = null;        // 主路线（绿色）
    let routeBorderPolyline = null;  // 主路线边框（浅绿色）
    let passedPolyline = null;       // 已走路线（灰色）
    let passedConnectLine = null;    // 用户位置到上一个点的灰色连接线
    let startMarker = null;          // 起点标记
    let endMarker = null;            // 终点标记
    let waypointMarkers = [];        // 途经点标记
    let userMarker = null;           // 用户位置标记
    let accuracyCircle = null;       // GPS精度圈
    let compassIndicator = null;     // 指北针
    let directionIndicator = null;   // 方向指示器（东南西北）

    // KML图层
    let kmlLayers = [];

    // 路线样式配置
    const ROUTE_STYLES = {
        planned: {
            strokeColor: '#00C853',
            strokeWeight: 8,         // 绿色路线宽度：8像素
            strokeOpacity: 1.0,      // 完全不透明
            zIndex: 185,             // 未走路线在下层
            borderWeight: 1,         // 边框宽度：1像素
            borderColor: '#7FD89F'   // 浅绿色边框
        },
        passed: {
            strokeColor: '#999999',
            strokeWeight: 8,         // 灰色路线宽度：8像素
            strokeOpacity: 1.0,      // 完全不透明（改为1.0）
            zIndex: 200              // 已走路线在上层
        }
    };

    /**
     * 初始化地图
     * @param {string} containerId - 地图容器ID
     * @param {Object} options - 地图配置
     * @returns {AMap.Map|null}
     */
    function initMap(containerId, options = {}) {
        try {
            const defaultOptions = {
                zoom: 17,
                center: [116.397428, 39.90923],
                mapStyle: 'amap://styles/normal',
                viewMode: '2D',
                features: ['bg', 'road', 'building'],
                showLabel: true
            };

            const mapOptions = Object.assign({}, defaultOptions, options);
            map = new AMap.Map(containerId, mapOptions);

            return map;
        } catch (e) {
            console.error('[NavRenderer] 地图初始化失败:', e);
            return null;
        }
    }

    /**
     * 获取地图实例
     * @returns {AMap.Map|null}
     */
    function getMap() {
        return map;
    }

    /**
     * 绘制路线（带浅绿色边框效果）
     * @param {Array} path - 路径点数组 [[lng,lat], ...]
     * @param {Object} options - 样式选项
     * @returns {AMap.Polyline|null}
     */
    function drawRoute(path, options = {}) {
        try {
            if (!map) {
                console.error('[NavRenderer] 地图未初始化');
                return null;
            }

            if (!path || path.length < 2) {
                console.error('[NavRenderer] 路径数据无效');
                return null;
            }

            // 清除旧路线（包括边框）
            if (routePolyline) {
                map.remove(routePolyline);
                routePolyline = null;
            }
            if (routeBorderPolyline) {
                map.remove(routeBorderPolyline);
                routeBorderPolyline = null;
            }

            const style = Object.assign({}, ROUTE_STYLES.planned, options);

            // 1. 先绘制边框（浅绿色，更宽）
            routeBorderPolyline = new AMap.Polyline({
                path: path,
                strokeColor: style.borderColor || '#7FD89F',
                strokeWeight: style.strokeWeight + (style.borderWeight || 1) * 2,  // 8 + 2 = 10px
                strokeOpacity: style.strokeOpacity,
                lineJoin: 'round',
                lineCap: 'round',
                zIndex: style.zIndex - 1,  // 边框在主线下方
                map: map
            });

            // 2. 再绘制主路线（绿色）
            routePolyline = new AMap.Polyline({
                path: path,
                strokeColor: style.strokeColor,
                strokeWeight: style.strokeWeight,
                strokeOpacity: style.strokeOpacity,
                lineJoin: 'round',
                lineCap: 'round',
                showDir: true,
                dirColor: '#FFFFFF',
                zIndex: style.zIndex,
                map: map
            });

            adjustViewToPath(path);
            return routePolyline;
        } catch (e) {
            console.error('[NavRenderer] 绘制路线失败:', e);
            return null;
        }
    }

    /**
     * 更新已走路线（基于点集索引）
     * @param {number} currentIndex - 当前吸附的点索引
     * @param {Array} currentPosition - 当前用户位置 [lng, lat]
     */
    function updatePassedRoute(currentIndex, currentPosition) {
        try {
            if (!map) return;

            const pointSet = window.navigationPointSet;
            if (!pointSet || pointSet.length === 0) return;

            if (currentIndex >= 1) {
                const passedPath = [];
                for (let i = 0; i <= currentIndex; i++) {
                    const pos = pointSet[i].position;
                    passedPath.push(pos);
                }

                if (passedPolyline) {
                    map.remove(passedPolyline);
                    passedPolyline = null;
                }

                passedPolyline = new AMap.Polyline({
                    path: passedPath,
                    strokeColor: ROUTE_STYLES.passed.strokeColor,
                    strokeWeight: ROUTE_STYLES.passed.strokeWeight,
                    strokeOpacity: ROUTE_STYLES.passed.strokeOpacity,
                    lineJoin: 'round',
                    lineCap: 'round',
                    zIndex: ROUTE_STYLES.passed.zIndex,
                    map: map
                });
            }

            // 绘制从最后点集点到当前GPS位置的连接线
            if (currentIndex >= 0 && currentPosition) {
                const lastPoint = pointSet[currentIndex].position;

                if (passedConnectLine) {
                    map.remove(passedConnectLine);
                    passedConnectLine = null;
                }

                passedConnectLine = new AMap.Polyline({
                    path: [lastPoint, currentPosition],
                    strokeColor: ROUTE_STYLES.passed.strokeColor,
                    strokeWeight: ROUTE_STYLES.passed.strokeWeight,
                    strokeOpacity: ROUTE_STYLES.passed.strokeOpacity,
                    lineJoin: 'round',
                    lineCap: 'round',
                    zIndex: ROUTE_STYLES.passed.zIndex,
                    map: map
                });
            }
        } catch (e) {
            console.error('[NavRenderer] 更新已走路线失败:', e);
        }
    }

    /**
     * 降低已完成路段的灰色路线层级（到绿色之下）
     */
    function lowerCompletedSegmentZIndex() {
        try {
            if (!map) return;

            // 降低已完成路段的灰色路线到绿色下方（zIndex: 180）
            if (passedPolyline) {
                passedPolyline.setOptions({ zIndex: 180 });
            }

            if (passedConnectLine) {
                passedConnectLine.setOptions({ zIndex: 180 });
            }
        } catch (e) {
            console.error('[NavRenderer] 降低层级失败:', e);
        }
    }

    /**
     * 开启/关闭路线方向箭头
     * @param {boolean} show - 是否显示
     */
    function toggleRouteArrows(show) {
        try {
            if (!routePolyline) return;

            if (typeof routePolyline.setOptions === 'function') {
                routePolyline.setOptions({
                    showDir: show,
                    dirColor: show ? '#FFFFFF' : undefined
                });
            }
        } catch (e) {
            console.error('[NavRenderer] 切换路线箭头失败:', e);
        }
    }

    /**
     * 添加起点终点标记
     * @param {Array} startPos - 起点 [lng, lat]
     * @param {Array} endPos - 终点 [lng, lat]
     * @param {Object} routeData - 路线数据（用于判断是否为"我的位置"）
     */
    function addRouteMarkers(startPos, endPos, routeData) {
        try {
            if (!map) return;

            clearRouteMarkers();

            const isMyLocationStart = routeData?.start?.name === '我的位置' ||
                                     routeData?.start?.isMyLocation === true;

            if (!isMyLocationStart && startPos) {
                const startIcon = new AMap.Icon({
                    size: new AMap.Size(30, 38),
                    image: 'images/工地数字导航小程序切图/司机/2X/地图icon/起点.png',
                    imageSize: new AMap.Size(30, 38)
                });

                startMarker = new AMap.Marker({
                    position: startPos,
                    icon: startIcon,
                    offset: new AMap.Pixel(-15, -38),
                    zIndex: 100,
                    map: map,
                    title: routeData?.start?.name || '起点'
                });
            }

            if (endPos) {
                const endIcon = new AMap.Icon({
                    size: new AMap.Size(30, 38),
                    image: 'images/工地数字导航小程序切图/司机/2X/地图icon/终点.png',
                    imageSize: new AMap.Size(30, 38)
                });

                endMarker = new AMap.Marker({
                    position: endPos,
                    icon: endIcon,
                    offset: new AMap.Pixel(-15, -38),
                    zIndex: 100,
                    map: map,
                    title: routeData?.end?.name || '终点'
                });
            }
        } catch (e) {
            console.error('[NavRenderer] 添加标记失败:', e);
        }
    }

    /**
     * 添加途经点标记
     * @param {Array} waypoints - 途经点数组 [{name, position}, ...]
     */
    function addWaypointMarkers(waypoints) {
        try {
            if (!map || !waypoints || waypoints.length === 0) return;

            clearWaypointMarkers();

            const waypointCount = waypoints.length;

            waypoints.forEach((wp, index) => {
                const pos = resolvePosition(wp);
                if (!pos) return;

                let marker;

                if (waypointCount === 1) {
                    const content = createWaypointHTML('途径点');
                    marker = new AMap.Marker({
                        position: pos,
                        content: content.element,
                        offset: new AMap.Pixel(-content.width / 2, -34),
                        zIndex: 99,
                        map: map,
                        title: wp?.name || '途径点'
                    });
                } else {
                    const content = createWaypointHTML(`途径点${index + 1}`);
                    marker = new AMap.Marker({
                        position: pos,
                        content: content.element,
                        offset: new AMap.Pixel(-content.width / 2, -34),
                        zIndex: 99,
                        map: map,
                        title: `途径点${index + 1}: ${wp?.name || ''}`
                    });
                }

                waypointMarkers.push(marker);
            });
        } catch (e) {
            console.error('[NavRenderer] 添加途经点标记失败:', e);
        }
    }

    /**
     * 创建途经点HTML标记
     * @param {string} text - 显示文本
     * @returns {Object} { element, width, height }
     */
    function createWaypointHTML(text) {
        // 计算文字宽度
        let textWidth = 0;
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = 'bold 10px "Microsoft YaHei","SimHei",Arial,sans-serif';
            textWidth = ctx.measureText(text).width;
        } catch (e) {
            textWidth = text.length * 10 * 0.55;
        }

        const adaptiveWidth = Math.max(26, Math.ceil(textWidth) + 8);
        const baseHeight = 34;

        const div = document.createElement('div');
        div.style.cssText = `position: relative; width: ${adaptiveWidth}px; height: ${baseHeight}px;`;

        const img = document.createElement('img');
        img.src = 'images/工地数字导航小程序切图/司机/2X/地图icon/途径点1.png';
        img.style.cssText = `width: ${adaptiveWidth}px; height: ${baseHeight}px; display: block;`;

        const label = document.createElement('div');
        label.textContent = text;
        label.style.cssText = `
            position: absolute;
            top: 7px;
            left: 50%;
            transform: translateX(-50%);
            color: #FFFFFF;
            font-size: 10px;
            font-weight: bold;
            font-family: 'Microsoft YaHei', 'SimHei', Arial, sans-serif;
            pointer-events: none;
            line-height: 1;
            z-index: 2;
            white-space: nowrap;
            text-shadow: 0 0 2px rgba(0,0,0,0.3);
        `;

        div.appendChild(img);
        div.appendChild(label);

        return { element: div, width: adaptiveWidth, height: baseHeight };
    }

    /**
     * 更新用户位置标记（支持平滑移动和图标切换）
     * @param {Array} position - [lng, lat]
     * @param {number} heading - 方向角（度）
     * @param {boolean} smooth - 是否平滑移动，默认true
     * @param {boolean} hasStarted - 是否已到达起点开始导航，默认false
     */
    function updateUserMarker(position, heading = 0, smooth = true, hasStarted = false) {
        try {
            if (!map) return;

            // 根据导航状态选择图标
            const iconImage = hasStarted 
                ? 'images/工地数字导航小程序切图/管理/2X/运输管理/临时车.png'  // 导航中：临时车图标
                : 'images/工地数字导航小程序切图/司机/2X/地图icon/我的位置.png';  // 未开始：我的位置图标

            if (!userMarker) {
                // 创建用户位置标记
                console.log('[NavRenderer] 创建用户位置标记:', position, hasStarted ? '(导航中)' : '(前往起点)');
                userMarker = new AMap.Marker({
                    position: position,
                    icon: new AMap.Icon({
                        size: new AMap.Size(40, 40),
                        image: iconImage,
                        imageSize: new AMap.Size(40, 40)
                    }),
                    offset: new AMap.Pixel(-20, -20),
                    zIndex: 300,
                    map: map
                });
            } else {
                // 更新图标（如果状态改变）
                const currentIcon = userMarker.getIcon();
                if (currentIcon && currentIcon.getImageUrl() !== iconImage) {
                    console.log('[NavRenderer] 切换位置图标:', hasStarted ? '临时车' : '我的位置');
                    userMarker.setIcon(new AMap.Icon({
                        size: new AMap.Size(40, 40),
                        image: iconImage,
                        imageSize: new AMap.Size(40, 40)
                    }));
                }

                // 更新位置
                if (smooth) {
                    // 平滑移动（使用高德的 moveTo 方法）
                    userMarker.moveTo(position, {
                        duration: 300,  // 300毫秒平滑移动
                        delay: 0
                    });
                } else {
                    // 直接跳转
                    userMarker.setPosition(position);
                }
            }

            // 更新方向（如果需要）
            if (heading !== null && heading !== undefined) {
                userMarker.setAngle(heading);
            }

            // 更新方向指示器（只在到达起点后显示）
            updateDirectionIndicator(position, hasStarted);
        } catch (e) {
            console.error('[NavRenderer] 更新用户标记失败:', e);
        }
    }

    /**
     * 创建或更新方向指示器（东南西北）
     * @param {Array} position - 位置 [lng, lat]
     * @param {boolean} show - 是否显示
     */
    function updateDirectionIndicator(position, show = true) {
        try {
            if (!map) return;

            if (!show) {
                // 隐藏方向指示器
                if (directionIndicator) {
                    map.remove(directionIndicator);
                    directionIndicator = null;
                }
                return;
            }

            if (!directionIndicator) {
                // 创建自定义覆盖物
                const DirectionOverlay = function(position) {
                    this.position = position;
                };

                DirectionOverlay.prototype = new AMap.Overlay();

                DirectionOverlay.prototype.onAdd = function() {
                    const div = document.createElement('div');
                    div.style.position = 'absolute';
                    div.style.width = '120px';
                    div.style.height = '120px';
                    div.style.pointerEvents = 'none';  // 不阻挡地图交互
                    div.style.zIndex = '299';  // 在用户标记下方
                    
                    const img = document.createElement('img');
                    img.src = 'images/工地数字导航小程序切图/司机/2X/导航/方向指示.png';
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.opacity = '0.8';
                    
                    div.appendChild(img);
                    this.el = div;
                    this.map.getContainer().appendChild(div);
                    this.updatePosition();
                };

                DirectionOverlay.prototype.onRemove = function() {
                    if (this.el && this.el.parentNode) {
                        this.el.parentNode.removeChild(this.el);
                    }
                    this.el = null;
                };

                DirectionOverlay.prototype.updatePosition = function() {
                    if (!this.el) return;
                    const pixel = this.map.lngLatToContainer(this.position);
                    this.el.style.left = (pixel.x - 60) + 'px';  // 居中（120/2=60）
                    this.el.style.top = (pixel.y - 60) + 'px';
                };

                DirectionOverlay.prototype.setPosition = function(position) {
                    this.position = position;
                    this.updatePosition();
                };

                directionIndicator = new DirectionOverlay(position);
                directionIndicator.setMap(map);

                // 监听地图移动事件，实时更新位置
                map.on('mapmove', function() {
                    if (directionIndicator && directionIndicator.updatePosition) {
                        directionIndicator.updatePosition();
                    }
                });

                console.log('[NavRenderer] 方向指示器已创建');
            } else {
                // 更新位置
                directionIndicator.setPosition(position);
            }
        } catch (e) {
            console.error('[NavRenderer] 更新方向指示器失败:', e);
        }
    }

    // 引导线（从当前位置到起点的虚线）
    let guideLineToStart = null;

    /**
     * 绘制从当前位置到起点的引导线（虚线）
     * @param {Array} currentPos - 当前位置 [lng, lat]
     * @param {Array} startPos - 起点位置 [lng, lat]
     */
    function drawGuideLineToStart(currentPos, startPos) {
        try {
            if (!map) return;

            // 清除旧的引导线
            if (guideLineToStart) {
                map.remove(guideLineToStart);
                guideLineToStart = null;
            }

            // 创建虚线引导线
            guideLineToStart = new AMap.Polyline({
                path: [currentPos, startPos],
                strokeColor: '#1E6FFF',  // 蓝色（与导航按钮颜色一致）
                strokeWeight: 4,
                strokeOpacity: 0.8,
                strokeStyle: 'dashed',   // 虚线
                strokeDasharray: [10, 5], // 虚线样式
                lineJoin: 'round',
                lineCap: 'round',
                zIndex: 195,  // 在绿色路线下方，灰色路线上方
                map: map
            });

            console.log('[NavRenderer] 引导线已绘制');
        } catch (e) {
            console.error('[NavRenderer] 绘制引导线失败:', e);
        }
    }

    /**
     * 清除引导线
     */
    function clearGuideLine() {
        try {
            if (guideLineToStart && map) {
                map.remove(guideLineToStart);
                guideLineToStart = null;
                console.log('[NavRenderer] 引导线已清除');
            }
        } catch (e) {
            console.error('[NavRenderer] 清除引导线失败:', e);
        }
    }

    /**
     * 绘制引导线（别名函数，兼容nav-core.js的调用）
     * @param {Array} currentPos - 当前位置 [lng, lat]
     * @param {Array} targetPos - 目标位置 [lng, lat]
     */
    function drawGuidanceLine(currentPos, targetPos) {
        drawGuideLineToStart(currentPos, targetPos);
    }

    /**
     * 更新GPS精度圈
     * @param {Array} position - [lng, lat]
     * @param {number} accuracy - 精度（米）
     */
    function updateAccuracyCircle(position, accuracy) {
        try {
            if (!map) return;

            if (!accuracyCircle) {
                accuracyCircle = new AMap.Circle({
                    center: position,
                    radius: accuracy,
                    strokeColor: '#007AFF',
                    strokeWeight: 1,
                    strokeOpacity: 0.3,
                    fillColor: '#007AFF',
                    fillOpacity: 0.1,
                    zIndex: 290,
                    map: map
                });
            } else {
                accuracyCircle.setCenter(position);
                accuracyCircle.setRadius(accuracy);
            }
        } catch (e) {
            console.error('[NavRenderer] 更新精度圈失败:', e);
        }
    }

    /**
     * 车头朝上模式：地图居中并旋转
     * @param {Array} position - 用户位置 [lng, lat]
     * @param {number} bearing - 行进方向（度数，0-360，正北为0）
     * @param {boolean} smooth - 是否平滑过渡
     */
    function setHeadingUpMode(position, bearing, smooth = true) {
        try {
            if (!map) return;

            const mapRotation = -bearing;

            if (smooth) {
                map.setCenter(position, false, 300);
                map.setRotation(mapRotation, false, 300);
            } else {
                map.setCenter(position);
                map.setRotation(mapRotation);
            }

            if (map.getZoom() < 17) {
                map.setZoom(17, false, 300);
            }
        } catch (e) {
            console.error('[NavRenderer] 设置车头朝上模式失败:', e);
        }
    }

    /**
     * 只移动地图中心，不旋转（直行时使用）
     * @param {Array} position - 用户位置 [lng, lat]
     * @param {boolean} smooth - 是否平滑过渡
     */
    function setCenterOnly(position, smooth = true) {
        try {
            if (!map) return;

            if (smooth) {
                map.setCenter(position, false, 300);
            } else {
                map.setCenter(position);
            }

            if (map.getZoom() < 17) {
                map.setZoom(17, false, 300);
            }
        } catch (e) {
            console.error('[NavRenderer] 移动地图中心失败:', e);
        }
    }

    /**
     * 重置地图旋转（北朝上）
     */
    function resetMapRotation() {
        try {
            if (!map) return;
            map.setRotation(0, false, 300);
        } catch (e) {
            console.error('[NavRenderer] 重置地图旋转失败:', e);
        }
    }

    /**
     * 加载并显示KML数据
     * @param {Object} kmlData - KML数据 { features, fileName }
     */
    function loadKMLData(kmlData) {
        try {
            if (!map || !kmlData || !kmlData.features) {
                console.warn('[NavRenderer] KML数据无效');
                return;
            }

            console.log('[NavRenderer] 加载KML数据...');

            const features = kmlData.features;
            const layerId = 'kml-' + Date.now();
            const displayMarkers = [];

            // 分离线和面
            const lines = features.filter(f => f.geometry?.type === 'line');
            const polygons = features.filter(f => f.geometry?.type === 'polygon');

            // 绘制面（按面积排序）
            const polygonsWithArea = polygons.map(p => ({
                ...p,
                area: calculatePolygonArea(p.geometry.coordinates)
            }));
            polygonsWithArea.sort((a, b) => b.area - a.area);

            polygonsWithArea.forEach((feature, index) => {
                const style = feature.geometry.style || {};
                const polygon = new AMap.Polygon({
                    path: feature.geometry.coordinates,
                    strokeColor: 'transparent',
                    strokeWeight: 0,
                    fillColor: style.fillColor || '#CCCCCC',
                    fillOpacity: style.fillOpacity || 0.3,
                    zIndex: 10 + index,
                    map: map
                });
                displayMarkers.push(polygon);
            });

            // 绘制线（统一样式：1px，#9AE59D）
            lines.forEach(feature => {
                const polyline = new AMap.Polyline({
                    path: feature.geometry.coordinates,
                    strokeColor: '#9AE59D',
                    strokeWeight: 1,
                    strokeOpacity: 1,
                    zIndex: 20,
                    map: map
                });

                // 【关键】设置 extData，供 kml-route-planning.js 使用
                polyline.setExtData({
                    name: feature.name || '未命名线',
                    type: '线',
                    description: feature.description || '',
                    coordinates: feature.geometry.coordinates
                });

                displayMarkers.push(polyline);
            });

            // 保存图层
            kmlLayers.push({
                id: layerId,
                name: kmlData.fileName || 'KML',
                visible: true,
                markers: displayMarkers,
                features: features
            });

            console.log('[NavRenderer] KML数据已加载，图层数:', kmlLayers.length);
        } catch (e) {
            console.error('[NavRenderer] 加载KML数据失败:', e);
        }
    }

    /**
     * 隐藏KML线要素
     */
    function hideKMLLines() {
        kmlLayers.forEach(layer => {
            if (!layer.markers) return;
            layer.markers.forEach(marker => {
                if (marker.CLASS_NAME === 'AMap.Polyline' ||
                    (marker.constructor && marker.constructor.name === 'Polyline')) {
                    marker.hide();
                }
            });
        });
    }

    /**
     * 显示KML线要素
     */
    function showKMLLines() {
        kmlLayers.forEach(layer => {
            if (!layer.markers) return;
            layer.markers.forEach(marker => {
                if (marker.CLASS_NAME === 'AMap.Polyline' ||
                    (marker.constructor && marker.constructor.name === 'Polyline')) {
                    marker.show();
                }
            });
        });
    }

    /**
     * 调整视野到路径
     * @param {Array} path - 路径点
     */
    function adjustViewToPath(path) {
        try {
            if (!map || !path || path.length === 0) return;

            let minLng = path[0][0], maxLng = path[0][0];
            let minLat = path[0][1], maxLat = path[0][1];

            path.forEach(point => {
                const lng = Array.isArray(point) ? point[0] : point.lng;
                const lat = Array.isArray(point) ? point[1] : point.lat;
                minLng = Math.min(minLng, lng);
                maxLng = Math.max(maxLng, lng);
                minLat = Math.min(minLat, lat);
                maxLat = Math.max(maxLat, lat);
            });

            const bounds = new AMap.Bounds([minLng, minLat], [maxLng, maxLat]);
            map.setBounds(bounds, false, [100, 100, 100, 100]);
        } catch (e) {
            console.error('[NavRenderer] 调整视野失败:', e);
        }
    }

    /**
     * 清除路线标记
     */
    function clearRouteMarkers() {
        if (startMarker && map) {
            map.remove(startMarker);
            startMarker = null;
        }
        if (endMarker && map) {
            map.remove(endMarker);
            endMarker = null;
        }
    }

    /**
     * 清除途经点标记
     */
    function clearWaypointMarkers() {
        if (waypointMarkers.length > 0 && map) {
            map.remove(waypointMarkers);
            waypointMarkers = [];
        }
    }

    /**
     * 清除所有覆盖物
     */
    function clearAll() {
        try {
            if (!map) return;

            if (routePolyline) map.remove(routePolyline);
            if (routeBorderPolyline) map.remove(routeBorderPolyline);
            if (passedPolyline) map.remove(passedPolyline);
            if (passedConnectLine) map.remove(passedConnectLine);
            clearRouteMarkers();
            clearWaypointMarkers();
            if (userMarker) map.remove(userMarker);
            if (accuracyCircle) map.remove(accuracyCircle);
            if (directionIndicator) map.remove(directionIndicator);

            routePolyline = null;
            routeBorderPolyline = null;
            passedPolyline = null;
            passedConnectLine = null;
            userMarker = null;
            accuracyCircle = null;
            directionIndicator = null;
        } catch (e) {
            console.error('[NavRenderer] 清除覆盖物失败:', e);
        }
    }

    /**
     * 销毁地图
     */
    function destroy() {
        try {
            clearAll();
            if (map) {
                map.destroy();
                map = null;
            }
            kmlLayers = [];
        } catch (e) {
            console.error('[NavRenderer] 销毁地图失败:', e);
        }
    }

    // ========== 工具函数 ==========

    function resolvePosition(point) {
        if (!point) return null;
        if (Array.isArray(point)) return point;
        if (point.position && Array.isArray(point.position)) return point.position;
        return null;
    }

    function calculatePolygonArea(coordinates) {
        if (!coordinates || coordinates.length < 3) return 0;
        let area = 0;
        const n = coordinates.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += coordinates[i][0] * coordinates[j][1];
            area -= coordinates[j][0] * coordinates[i][1];
        }
        return Math.abs(area) / 2;
    }

    // 公开API
    return {
        initMap,
        getMap,
        drawRoute,
        updatePassedRoute,
        lowerCompletedSegmentZIndex,
        toggleRouteArrows,
        addRouteMarkers,
        addWaypointMarkers,
        updateUserMarker,
        updateDirectionIndicator,
        updateAccuracyCircle,
        setHeadingUpMode,
        setCenterOnly,  // 【新增】只移动中心，不旋转
        resetMapRotation,
        loadKMLData,
        hideKMLLines,
        showKMLLines,
        adjustViewToPath,
        clearRouteMarkers,
        clearWaypointMarkers,
        clearAll,
        destroy,
        
        // 【新增】引导线相关
        drawGuideLineToStart,
        drawGuidanceLine,  // 别名函数
        clearGuideLine,

        // 暴露KML图层给路径规划模块使用
        getKMLLayers: () => kmlLayers
    };
})();

// 导出到全局
window.NavRenderer = NavRenderer;
