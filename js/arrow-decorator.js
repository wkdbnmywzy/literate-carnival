// arrow-decorator.js
// 在高德地图上为路径（Polyline 或原始坐标数组）绘制沿线箭头，支持双向且错相（不重叠）

(function(global){
    const ArrowDecorator = {
        // 初始化配置
        defaults: {
            minZoom: 15,              // 低于该缩放级别不显示箭头，避免拥挤
            baseSpacingMeters: 60,    // 在参考缩放级别的箭头间距
            referenceZoom: 17,        // 参考缩放级别（在此级别下使用 baseSpacingMeters）
            maxArrowsPerLine: 50,     // 单条线最多箭头数，保障性能
            arrowSizePx: 10,          // 箭头图标尺寸（像素）
            color: '#9E9E9E',         // 箭头颜色
            twoWay: true,             // 默认按双向道路处理
            // 根据可见图层数量调整稀疏度：layerCount=1 → 1.0；更多图层逐步增大间距
            spacingScaleByLayerCount: function(layerCount){
                if (!layerCount || layerCount <= 1) return 1.0;
                // 1 → 1.0, 2 → 1.3, 3 → 1.6, 4+ → 2.0（上限）
                const scale = 1.0 + Math.min(1.0, 0.3 * (layerCount - 1));
                return Math.min(scale, 2.0);
            }
        },

        // 供外部调用：为一组“线要素（coordinates数组）”生成箭头
        decorateLinesOnMap: function(map, lineFeatures, options){
            if (!map || !lineFeatures || !lineFeatures.length) return [];
            const opts = Object.assign({}, this.defaults, options || {});
            const layerCount = (global.kmlLayers && Array.isArray(global.kmlLayers)) ? global.kmlLayers.length : 1;
            const spacingScale = opts.spacingScaleByLayerCount(layerCount);
            const zoom = typeof map.getZoom === 'function' ? (map.getZoom() || opts.referenceZoom) : opts.referenceZoom;

            const spacingMeters = this._calcSpacingMeters(opts.baseSpacingMeters, zoom, opts.referenceZoom) * spacingScale;
            const showArrows = zoom >= opts.minZoom;

            const markers = [];
            if (!showArrows) return markers;

            for (const feature of lineFeatures) {
                const path = feature && feature.geometry && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : null;
                if (!path || path.length < 2) continue;

                // 前向箭头（phase=0）
                const forward = this._generateArrowMarkersForPath(map, path, {
                    arrowSizePx: opts.arrowSizePx,
                    color: (feature.geometry.style && feature.geometry.style.color) || opts.color,
                    spacingMeters,
                    phaseMeters: 0,
                    reverse: false,
                    maxArrows: opts.maxArrowsPerLine
                });
                markers.push(...forward);

                // 双向：反向箭头（phase=spacing/2，避免与前向重叠）
                if (opts.twoWay) {
                    const backward = this._generateArrowMarkersForPath(map, path, {
                        arrowSizePx: opts.arrowSizePx,
                        color: (feature.geometry.style && feature.geometry.style.color) || opts.color,
                        spacingMeters,
                        phaseMeters: spacingMeters / 2,
                        reverse: true,
                        maxArrows: opts.maxArrowsPerLine
                    });
                    markers.push(...backward);
                }
            }
            return markers;
        },

        // 清理一组箭头标记
        removeMarkers: function(map, markers){
            if (!map || !markers || !markers.length) return;
            try { map.remove(markers); } catch(e) {}
        },

        // 计算随缩放变化的间距（放大 → 更密集；缩小 → 更稀疏）
        _calcSpacingMeters: function(base, zoom, ref){
            const dz = (ref || 17) - (zoom || ref);
            // 每缩小1级，间距×1.6；每放大1级，间距/1.6（经验值）
            return base * Math.pow(1.6, dz);
        },

        // 生成某条坐标路径上的箭头标记
        _generateArrowMarkersForPath: function(map, path, opt){
            const markers = [];
            if (!path || path.length < 2) return markers;

            const spacing = Math.max(5, opt.spacingMeters || 60);
            const phase = Math.max(0, opt.phaseMeters || 0) % spacing;
            const maxArrows = Math.max(1, opt.maxArrows || 50);
            const sizePx = Math.max(6, opt.arrowSizePx || 10);
            const color = opt.color || '#9E9E9E';
            const reverse = !!opt.reverse;

            // 预生成图标
            const icon = new AMap.Icon({
                size: new AMap.Size(sizePx, sizePx),
                image: this._createArrowSvgDataUrl(color, sizePx),
                imageSize: new AMap.Size(sizePx, sizePx)
            });

            // 逐段累计长度并在等距处放置箭头
            let acc = 0; // 累计总长
            let nextPosAt = phase; // 下一个箭头的累计长度位置
            let arrows = 0;

            // 决定遍历方向
            const pts = reverse ? path.slice().reverse() : path;

            for (let i = 0; i < pts.length - 1 && arrows < maxArrows; i++) {
                const a = pts[i];
                const b = pts[i+1];
                if (!a || !b) continue;
                const segLen = this._distanceMeters(a, b);
                if (!isFinite(segLen) || segLen <= 0) { acc += 0; continue; }

                // 当前线段覆盖的累计区间：[acc, acc+segLen]
                while (nextPosAt <= acc + segLen && arrows < maxArrows) {
                    const t = (nextPosAt - acc) / segLen; // 0..1
                    const lng = a[0] + (b[0] - a[0]) * t;
                    const lat = a[1] + (b[1] - a[1]) * t;

                    // 朝向：沿段方向（反向时 a→b 已经反转，所以统一使用 a→b）
                    const angle = this._bearingDegrees(a, b);

                    const m = new AMap.Marker({
                        position: [lng, lat],
                        icon: icon,
                        // 居中对齐，便于旋转
                        offset: new AMap.Pixel(-sizePx/2, -sizePx/2),
                        angle: angle,
                        zIndex: 21,
                        map: map
                    });
                    markers.push(m);
                    arrows++;
                    nextPosAt += spacing;
                }

                acc += segLen;
            }

            return markers;
        },

        // 球面近似：两点距离（米）
        _distanceMeters: function(a, b){
            const toRad = d => d * Math.PI / 180;
            const R = 6371000;
            const lat1 = toRad(a[1]);
            const lat2 = toRad(b[1]);
            const dlat = toRad(b[1] - a[1]);
            const dlng = toRad(b[0] - a[0]);
            const sinDlat = Math.sin(dlat/2);
            const sinDlng = Math.sin(dlng/2);
            const h = sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlng*sinDlng;
            const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
            return R * c;
        },

        // 计算 a→b 的方位角（度，0..360，正北为0，顺时针）
        _bearingDegrees: function(a, b){
            const lng1 = a[0], lat1 = a[1];
            const lng2 = b[0], lat2 = b[1];
            const lat1Rad = lat1 * Math.PI / 180;
            const lat2Rad = lat2 * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat2Rad);
            const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
            const br = Math.atan2(y, x) * 180 / Math.PI;
            return (br + 360) % 360;
        },

        // 生成简洁箭头SVG（上指三角形），用于沿线标注
        _createArrowSvgDataUrl: function(color, size){
            const fill = color || '#9E9E9E';
            const s = Math.max(8, size || 10);
            const svg = `
                <svg width="${s}" height="${s}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <g>
                        <path d="M10 2 L18 18 L10 14 L2 18 Z" fill="${fill}" />
                    </g>
                </svg>`;
            try { return 'data:image/svg+xml;base64,' + btoa(svg); } catch(e) { return '' }
        }
    };

    // 暴露到全局
    global.ArrowDecorator = ArrowDecorator;
})(window);
