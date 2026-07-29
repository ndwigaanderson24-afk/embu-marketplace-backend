// ===== LAUNCHER WITH 6-SECOND COUNTDOWN =====
document.addEventListener('DOMContentLoaded', function() {
    const launcher = document.getElementById('launcher');
    const mainSite = document.getElementById('main-site');
    const countdownNumber = document.getElementById('countdown-number');
    const countdownCircle = document.getElementById('countdown-circle');
    const loaderBar = document.getElementById('loader-bar');
    
    let seconds = 6;
    const circumference = 339.292; // 2 * PI * 54
    
    // Set initial circle state
    countdownCircle.style.strokeDashoffset = '0';
    
    // Update countdown every second
    const countdownInterval = setInterval(() => {
        seconds--;
        
        // Update number
        countdownNumber.textContent = seconds;
        
        // Update circle
        const progress = (6 - seconds) / 6;
        const offset = circumference * progress;
        countdownCircle.style.strokeDashoffset = offset;
        
        // Update loader bar
        const percentage = (6 - seconds) / 6 * 100;
        loaderBar.style.width = percentage + '%';
        
        // Change color when nearing end
        if (seconds <= 2) {
            countdownNumber.style.color = '#FF6B6B';
            countdownCircle.style.stroke = '#FF6B6B';
        }
        
        // When countdown reaches 0
        if (seconds === 0) {
            clearInterval(countdownInterval);
            
            // Fade out launcher
            launcher.classList.add('fade-out');
            
            // Show main site after fade
            setTimeout(() => {
                launcher.style.display = 'none';
                mainSite.style.display = 'block';
            }, 800);
        }
    }, 1000);
    
    // Optional: Allow click to skip (but keep it subtle)
    launcher.addEventListener('click', function(e) {
        // Only skip if clicked on background, not on buttons
        if (e.target === launcher || e.target === this) {
            // Quick skip
            clearInterval(countdownInterval);
            launcher.classList.add('fade-out');
            setTimeout(() => {
                launcher.style.display = 'none';
                mainSite.style.display = 'block';
            }, 800);
        }
    });
});

// ===== PRODUCT DATA =====
const products = [
    { id: 1, name: 'Fresh Avocados', price: 300, description: '🥑 Locally grown in Embu' },
    { id: 2, name: 'Organic Coffee', price: 450, description: '☕ Fresh from Embu farms' },
    { id: 3, name: 'Handmade Baskets', price: 800, description: '🧺 Traditional Embu crafts' },
    { id: 4, name: 'Pure Honey (500g)', price: 600, description: '🍯 Sweet Embu honey' },
    { id: 5, name: 'Macadamia Nuts', price: 500, description: '🥜 Premium quality nuts' },
    { id: 6, name: 'Fresh Vegetables', price: 200, description: '🥬 Farm-fresh daily' },
];

let cart = [];
let cartTotal = 0;

// ===== DISPLAY PRODUCTS =====
function displayProducts() {
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    
    grid.innerHTML = products.map(product => `
        <div class="product-card">
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <p class="price">KES ${product.price}</p>
            <button onclick="addToCart(${product.id})">🛒 Add to Cart</button>
        </div>
    `).join('');
}

// ===== CART FUNCTIONS =====
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    cart.push(product);
    cartTotal += product.price;
    updateCartUI();
    showNotification(`✅ ${product.name} added to cart!`);
}

function updateCartUI() {
    const cartCount = document.getElementById('cart-count');
    const cartTotalElement = document.getElementById('cart-total');
    const cartItems = document.getElementById('cart-items');
    
    if (cartCount) cartCount.textContent = cart.length;
    if (cartTotalElement) cartTotalElement.textContent = cartTotal;
    
    if (!cartItems) return;
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="color:#999; text-align:center;">🛒 Your cart is empty</p>';
        return;
    }
    
    cartItems.innerHTML = cart.map(item => `
        <div style="display:flex; justify-content:space-between; padding:0.8rem 0; border-bottom:1px solid #eee;">
            <span>${item.name}</span>
            <span style="color:#006B3F; font-weight:600;">KES ${item.price}</span>
        </div>
    `).join('');
}

function toggleCart() {
    const modal = document.getElementById('cart-modal');
    if (modal) {
        modal.classList.toggle('hidden');
        updateCartUI();
    }
}

function closeCart() {
    const modal = document.getElementById('cart-modal');
    if (modal) modal.classList.add('hidden');
}

function checkout() {
    if (cart.length === 0) {
        alert('🛒 Your cart is empty!');
        return;
    }
    
    alert(`🎉 Order placed! Total: KES ${cartTotal}\n\nThank you for supporting Embu businesses! 🇰🇪`);
    cart = [];
    cartTotal = 0;
    updateCartUI();
    closeCart();
}

// ===== NOTIFICATION =====
function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: #006B3F;
        color: white;
        padding: 1rem 2rem;
        border-radius: 12px;
        animation: slideIn 0.3s ease;
        z-index: 3000;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        font-weight: 500;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add slide animations
const animStyle = document.createElement('style');
animStyle.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(animStyle);

// ===== SCROLL TO PRODUCTS =====
function scrollToProducts() {
    const productsSection = document.getElementById('products');
    if (productsSection) {
        productsSection.scrollIntoView({ behavior: 'smooth' });
    }
}

// ===== CONTACT FORM =====
function handleContact(e) {
    if (e) e.preventDefault();
    alert('📩 Thank you for reaching out! We\'ll get back to you soon from Embu! 🇰🇪');
    if (e && e.target) e.target.reset();
}

// ===== CART EVENT LISTENER =====
document.addEventListener('DOMContentLoaded', function() {
    const cartIcon = document.querySelector('.cart-icon');
    if (cartIcon) {
        cartIcon.addEventListener('click', toggleCart);
    }
    
    // Initialize products
    displayProducts();
});