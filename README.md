# ☕ Smart Dynamic Menu & Micro-Order System

An interactive, responsive single-page Web Application designed for restaurants, cafes, and small businesses to handle real-time dynamic digital menus and instant WhatsApp order placement.

---

## 🌟 Key Features

### 🛒 Customer View (`index.html`)
* **Interactive Digital Menu:** Browse items filtered by categories with instant real-time pricing and stock status.
* **Smart Cart:** Dynamic quantity adjustment, item persistence via LocalStorage, and live total calculation.
* **WhatsApp Deep-Link Dispatch:** Generates a pre-formatted, structured order summary (Table Number, Customer Name, Items, Notes, Grand Total) and sends it directly to the owner's WhatsApp number.

### ⚙️ Owner Admin Dashboard (`admin.html`)
* **Live Inventory Control:** Easily toggle items as "In Stock" or "Sold Out".
* **Menu Management:** Add new dishes, edit prices, or delete outdated items effortlessly.
* **Instant Dynamic Sync:** Changes made in the Admin panel automatically update on all customer devices.

---

## 🚀 Tech Stack

* **Frontend:** HTML5, CSS3, Modern JavaScript (ES6+)
* **Database:** Firebase Realtime Database (with fallback LocalStorage Demo Mode)
* **Messaging:** WhatsApp Universal Deep-Linking (`wa.me`)
* **Hosting:** GitHub Pages

---

## 📌 How to Run & Setup

1. **Clone the Repository:**
   ```bash
   git clone [https://github.com/kalaivani-m-131005/smart-menu-system.git](https://github.com/kalaivani-m-131005/smart-menu-system.git)
