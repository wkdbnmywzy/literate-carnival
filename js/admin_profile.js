// 管理员我的页面 JavaScript

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检查登录状态
    checkLoginStatus();
    
    // 加载用户信息
    loadUserInfo();
    
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

// 加载用户信息
function loadUserInfo() {
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
    const driverNameElement = document.querySelector('.driver-name');
    
    if (driverNameElement && currentUser.username) {
        driverNameElement.textContent = currentUser.username;
    }
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
    
    // 退出登录按钮
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
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
            window.location.href = 'admin_transport.html';
            break;
        case 'admin-profile':
            // 当前就是我的页面
            break;
    }
}

// 处理退出登录
function handleLogout() {
    // 确认退出
    if (confirm('确定要退出登录吗？')) {
        // 清除登录信息
        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('currentUser');
        sessionStorage.removeItem('loginTime');
        sessionStorage.removeItem('loginType');
        
        console.log('已退出登录');
        
        // 跳转到登录页
        window.location.href = 'login.html';
    }
}
