// 管理员导航页面 JavaScript
// map 变量已在 config.js 中声明，这里直接使用

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查登录状态
    checkLoginStatus();
    
    // 初始化地图
    initMap();
    
    // 初始化事件监听
    initEventListeners();
});

// 检查登录状态
function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
    
    if (!isLoggedIn || currentUser.role !== 'manager') {
        // 未登录或不是管理员，跳转到登录页
        window.location.href = 'login.html';
        return;
    }
    
    console.log('管理员已登录:', currentUser);
}

// 初始化地图
function initMap() {
    // 创建地图实例
    map = new AMap.Map('map-container', {
        zoom: 15,
        center: [114.305215, 30.593099], // 默认中心点（武汉）
        mapStyle: 'amap://styles/normal',
        viewMode: '2D',
        pitch: 0,
        rotation: 0,
        showLabel: true,
        features: ['bg', 'road', 'building', 'point']
    });
    
    console.log('管理员地图初始化完成');
}

// 初始化事件监听
function initEventListeners() {
    // 底部导航切换
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const page = this.dataset.page;
            handleNavigation(page);
        });
    });
    
    // 搜索框点击
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('click', function() {
            console.log('搜索功能待实现');
            // TODO: 跳转到搜索页面
        });
    }
    
    // 筛选项点击
    const filterItems = document.querySelectorAll('.filter-item');
    filterItems.forEach(item => {
        item.addEventListener('click', function() {
            const filterType = this.querySelector('span').textContent;
            console.log('筛选:', filterType);
            // TODO: 实现筛选功能
        });
    });
    
    // 右侧控制按钮
    const locateBtn = document.getElementById('locate-btn');
    const cameraBtn = document.getElementById('camera-btn');
    const vehicleToggleBtn = document.getElementById('vehicle-toggle-btn');
    const vehicleLegend = document.getElementById('vehicle-legend');
    
    // 定位按钮
    if (locateBtn) {
        locateBtn.addEventListener('click', function() {
            console.log('定位功能待实现');
            // TODO: 实现定位功能
        });
    }
    
    // 摄像头按钮
    if (cameraBtn) {
        cameraBtn.addEventListener('click', function() {
            console.log('摄像头功能待实现');
            // TODO: 实现摄像头功能
        });
    }
    
    // 车辆切换按钮
    if (vehicleToggleBtn && vehicleLegend) {
        vehicleToggleBtn.addEventListener('click', function() {
            // 切换按钮激活状态
            this.classList.toggle('active');
            
            // 切换车辆图例显示/隐藏
            if (vehicleLegend.style.display === 'none') {
                vehicleLegend.style.display = 'flex';
                console.log('车辆图例显示');
            } else {
                vehicleLegend.style.display = 'none';
                console.log('车辆图例隐藏');
            }
        });
    }
    
    // 底部卡片展开/收起
    const bottomCard = document.getElementById('bottom-card');
    const cardHandle = document.getElementById('card-handle');
    const mapControls = document.querySelector('.admin-map-controls');
    
    if (cardHandle && bottomCard) {
        cardHandle.addEventListener('click', function() {
            bottomCard.classList.toggle('expanded');
            
            // 卡片展开时，右侧按钮和车辆图例上移
            if (bottomCard.classList.contains('expanded')) {
                if (mapControls) mapControls.classList.add('card-expanded');
                if (vehicleLegend) vehicleLegend.classList.add('card-expanded');
            } else {
                if (mapControls) mapControls.classList.remove('card-expanded');
                if (vehicleLegend) vehicleLegend.classList.remove('card-expanded');
            }
        });
    }
    
    // 起点终点输入框点击 - 跳转到点位选择页面
    const startLocation = document.getElementById('start-location');
    const endLocation = document.getElementById('end-location');
    
    if (startLocation) {
        startLocation.addEventListener('click', function() {
            sessionStorage.setItem('selectingPointType', 'start');
            window.location.href = 'point-selection.html';
        });
    }
    
    if (endLocation) {
        endLocation.addEventListener('click', function() {
            sessionStorage.setItem('selectingPointType', 'end');
            window.location.href = 'point-selection.html';
        });
    }
    
    // 添加途径点按钮
    const addWaypointBtn = document.getElementById('add-waypoint-btn');
    if (addWaypointBtn) {
        addWaypointBtn.addEventListener('click', function() {
            console.log('添加途径点功能待实现');
            // TODO: 实现添加途径点功能
        });
    }
}

// 处理导航切换
function handleNavigation(page) {
    console.log('导航到:', page);
    
    // 根据不同页面跳转
    switch(page) {
        case 'admin-navigation':
            // 当前就是导航页面
            break;
        case 'admin-data':
            // 跳转到外部工地数据系统
            window.location.href = 'http://sztymap.0x3d.cn:11080/#/pages/login/login';
            break;
        case 'admin-transport':
            window.location.href = 'admin_transport.html';
            break;
        case 'admin-profile':
            window.location.href = 'admin_profile.html';
            break;
    }
}
