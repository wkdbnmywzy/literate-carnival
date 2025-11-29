// 运输管理页面 JavaScript

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查登录状态
    checkLoginStatus();
    
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
    
    // 顶部标签切换
    const tabItems = document.querySelectorAll('.tab-item');
    tabItems.forEach(item => {
        item.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
        });
    });
    
    // 新增任务按钮
    const addTaskBtn = document.querySelector('.add-task-btn');
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', function() {
            console.log('新增任务功能待实现');
            // TODO: 实现新增任务功能
        });
    }
}

// 切换标签页
function switchTab(tab) {
    // 更新标签样式
    const tabItems = document.querySelectorAll('.tab-item');
    tabItems.forEach(item => {
        if (item.dataset.tab === tab) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // 切换内容显示
    const vehicleTab = document.getElementById('vehicle-tab');
    const taskTab = document.getElementById('task-tab');
    
    if (tab === 'vehicle') {
        vehicleTab.style.display = 'block';
        taskTab.style.display = 'none';
    } else {
        vehicleTab.style.display = 'none';
        taskTab.style.display = 'block';
    }
}

// 处理导航切换
function handleNavigation(page) {
    console.log('导航到:', page);
    
    // 根据不同页面跳转
    switch(page) {
        case 'admin-navigation':
            window.location.href = 'admin_index.html';
            break;
        case 'admin-data':
            // 跳转到外部工地数据系统
            window.location.href = 'http://sztymap.0x3d.cn:11080/#/pages/login/login';
            break;
        case 'admin-transport':
            // 当前就是运输管理页面
            break;
        case 'admin-profile':
            window.location.href = 'admin_profile.html';
            break;
    }
}
