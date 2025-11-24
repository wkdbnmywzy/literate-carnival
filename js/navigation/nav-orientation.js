/* nav-orientation.js
 * 设备方向捕获模块：在未到达起点阶段用真实设备朝向旋转“我的位置”图标。
 * 提供 getHeading() 与订阅接口；iOS 13+ 需要 requestPermission()。
 */
const NavOrientation = (function() {
  'use strict';
  let enabled = false;
  let lastHeading = 0; // 0-360 北=0 顺时针递增
  let lastEventTime = 0;
  let throttleMs = 120;
  let listeners = [];
  let hasPermission = true;
  const debug = () => window.NAV_DEBUG === true;

  async function requestPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        hasPermission = (state === 'granted');
        if (debug()) console.debug('[NavOrientation] permission:', state);
        return hasPermission;
      } catch(e) {
        console.error('[NavOrientation] requestPermission失败:', e);
        hasPermission = false;
        return false;
      }
    }
    return true; // 非 iOS 直接视为有权限
  }

  async function init(opts = {}) {
    if (enabled) return true;
    if (opts.throttle && typeof opts.throttle === 'number') throttleMs = Math.max(30, opts.throttle);
    if (typeof window === 'undefined') return false;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      await requestPermission();
      if (!hasPermission) return false;
    }
    window.addEventListener('deviceorientation', handleOrientation, false);
    enabled = true;
    if (debug()) console.debug('[NavOrientation] 启动监听');
    return true;
  }

  function handleOrientation(ev) {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastEventTime < throttleMs) return; // 节流
    lastEventTime = now;
    let alpha = ev.alpha;
    if (alpha == null) return;
    alpha = (alpha + 360) % 360; // 归一化
    let screenAngle = 0;
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      screenAngle = window.screen.orientation.angle;
    } else if (typeof window.orientation === 'number') {
      screenAngle = window.orientation; // 旧 API
    }
    let heading = (alpha + screenAngle + 360) % 360;
    lastHeading = heading;
    if (debug()) console.debug('[NavOrientation] heading', heading.toFixed(1));
    listeners.forEach(fn => { try { fn(heading); } catch(_){} });
  }

  function getHeading() { return lastHeading; }
  function subscribe(cb) { if (typeof cb === 'function') listeners.push(cb); }
  function unsubscribe(cb) { listeners = listeners.filter(f => f !== cb); }
  function destroy() {
    if (!enabled) return;
    window.removeEventListener('deviceorientation', handleOrientation, false);
    enabled = false;
    listeners = [];
    if (debug()) console.debug('[NavOrientation] 已停止');
  }
  return { init, requestPermission, getHeading, subscribe, unsubscribe, destroy };
})();
window.NavOrientation = NavOrientation;
