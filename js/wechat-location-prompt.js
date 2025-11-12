(function(){
  // 简单的微信环境检测
  function isWeChat(){
    return /MicroMessenger/i.test(navigator.userAgent || "");
  }

  // 创建样式
  function injectStyle(){
    if (document.getElementById('wx-loc-style')) return;
    var style = document.createElement('style');
    style.id = 'wx-loc-style';
    style.innerHTML = '\n.wx-loc-mask{position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;}\n.wx-loc-modal{width:84%;max-width:520px;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,0.2);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,\"Noto Sans\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft YaHei\",sans-serif;}\n.wx-loc-hd{padding:16px 18px 6px 18px;font-size:16px;font-weight:600;color:#111;}\n.wx-loc-bd{padding:0 18px 14px 18px;color:#555;font-size:14px;line-height:1.6;}\n.wx-loc-bd .wx-loc-tip{background:#F7FBF8;border:1px solid #CDE8D4;color:#2E7D32;border-radius:8px;padding:10px 12px;margin-top:8px;}\n.wx-loc-ft{display:flex;gap:10px;padding:14px;background:#f7f7f7;}\n.wx-loc-btn{flex:1;height:40px;border:none;border-radius:10px;font-size:14px;cursor:pointer}\n.wx-loc-btn.primary{background:#1AAD19;color:#fff;}\n.wx-loc-btn.secondary{background:#e9e9e9;color:#333;}\n.wx-loc-mini{font-size:12px;color:#888;margin-top:8px;}\n';
    document.head.appendChild(style);
  }

  // 创建弹窗
  function createModal(){
    injectStyle();
    var mask = document.createElement('div');
    mask.className = 'wx-loc-mask';

    var box = document.createElement('div');
    box.className = 'wx-loc-modal';

    var hd = document.createElement('div');
    hd.className = 'wx-loc-hd';
    hd.textContent = '需要定位权限';

    var bd = document.createElement('div');
    bd.className = 'wx-loc-bd';
    bd.innerHTML = '\n      为了为你规划路线并定位到当前位置，请允许获取位置信息。<br/>\n      在微信中，定位权限由“微信”统一管理，可能不会弹出浏览器原生授权框。\n      <div class="wx-loc-tip">\n        点“立即授权”尝试获取定位；如果失败，请到：我 → 设置 → 隐私 → 定位服务，给“微信”开启定位权限，再返回本页面。\n      </div>\n      <div class="wx-loc-mini">提示：允许后不会反复打扰，本次会话内不再显示。</div>\n    ';

    var ft = document.createElement('div');
    ft.className = 'wx-loc-ft';

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'wx-loc-btn primary';
    confirmBtn.textContent = '立即授权';

    var laterBtn = document.createElement('button');
    laterBtn.className = 'wx-loc-btn secondary';
    laterBtn.textContent = '稍后再说';

    ft.appendChild(laterBtn);
    ft.appendChild(confirmBtn);
    box.appendChild(hd);
    box.appendChild(bd);
    box.appendChild(ft);
    mask.appendChild(box);

    // 行为：只在本次会话显示一次
    function close(){
      try{ sessionStorage.setItem('wxLocPromptShown', '1'); }catch(e){}
      if (mask && mask.parentNode) mask.parentNode.removeChild(mask);
    }

    laterBtn.addEventListener('click', close);

    // 授权动作：优先微信JS-SDK，其次浏览器Geolocation
    confirmBtn.addEventListener('click', function(){
      // 防重复点击
      confirmBtn.disabled = true;
      confirmBtn.textContent = '正在请求...';

      function onSuccess(lng, lat){
        try {
          // 存一份给现有页面可用（与现有代码保持一致键名）
          sessionStorage.setItem('currentPosition', JSON.stringify([lng, lat]));
        } catch(e) {}
        // 通知页面
        try {
          window.dispatchEvent(new CustomEvent('wechat-location-granted', { detail: { lng: lng, lat: lat } }));
        } catch(e) {}
        close();
      }

      function onFail(msg){
        // 友好提示但不强制
        alert(msg || '定位失败，请在微信设置中开启定位权限后重试');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '立即授权';
      }

      // 1) 微信JS-SDK
      if (window.wx && typeof wx.getLocation === 'function'){
        try{
          wx.getLocation({
            type: 'gcj02', // 与高德一致
            success: function(res){
              // 微信返回lat,lng
              onSuccess(res.longitude, res.latitude);
            },
            fail: function(err){
              // 失败则尝试浏览器API
              tryBrowserGeo();
            },
            cancel: function(){ onFail('已取消定位授权'); }
          });
          return;
        }catch(e){ /* 兜底继续浏览器API */ }
      }

      // 2) 浏览器Geolocation（在微信内可能无弹窗，但有时可用）
      tryBrowserGeo();

      function tryBrowserGeo(){
        if (!('geolocation' in navigator)){
          onFail('当前环境不支持定位');
          return;
        }
        navigator.geolocation.getCurrentPosition(function(pos){
          // 注意：这里返回的是WGS84坐标；项目中地图使用GCJ-02，
          // 仅用于触发授权/存储；真正使用时页面已有转换逻辑。
          onSuccess(pos.coords.longitude, pos.coords.latitude);
        }, function(err){
          onFail(err && err.message ? ('定位失败：' + err.message) : '定位失败');
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      }
    });

    document.body.appendChild(mask);
  }

  function shouldShow(){
    try{ if (sessionStorage.getItem('wxLocPromptShown') === '1') return false; }catch(e){}
    return true;
  }

  function init(){
    if (!isWeChat()) return;
    if (!shouldShow()) return;
    // 等待DOM可用
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', createModal);
    } else {
      createModal();
    }
  }

  // 自动初始化
  init();

  // 暴露一个手动API（可选）
  window.WechatLocationPrompt = {
    show: function(){ createModal(); }
  };
})();
