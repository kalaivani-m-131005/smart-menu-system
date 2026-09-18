# ☕ Smart Dynamic Menu & Instant WhatsApp Ordering System

[![Live Demo](https://img.shields.io/badge/Live_App-GitHub_Pages-2ea44f?style=for-the-badge&logo=githubpages)](https://kalaivani-m-131005.github.io/smart-menu-system/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML5-Modern_UI-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Direct_Order-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/919976775973)

An interactive, responsive single-page web application designed for modern cafes, food courts, and small restaurants. It enables customers to browse a digital menu with live stock availability and place instant formatted orders directly to the shop owner's WhatsApp!

---

## 🌐 Live Application Portals

| Application Portal | Direct Live Link | Description |
| :--- | :--- | :--- |
| 🛒 **Customer Menu** | [Open Customer App](https://kalaivani-m-131005.github.io/smart-menu-system/) | Browse dishes, dynamic cart, table order dispatch |
| ⚙️ **Admin Dashboard** | [Open Admin Portal](https://kalaivani-m-131005.github.io/smart-menu-system/admin.html) | Live stock status toggle, menu item management |

---

## ✨ Key Features & Highlights

### 🛒 Customer Experience (`index.html`)
* **Dynamic Category Filter:** Filter menu by Hot Drinks, Tiffin, Snacks, and Desserts.
* **Smart Micro-Cart:** Live total calculation, quantity controls, and local state preservation.
* **Instant WhatsApp Dispatch:** Generates pre-formatted order templates with Table No, Customer Name, Custom Notes, and Grand Total.

### ⚙️ Store Owner Control (`admin.html`)
* **Realtime Inventory Toggle:** Instantly mark items as `In Stock` or `Sold Out`.
* **Dynamic Item Management:** Add new items, update prices, or remove outdated dishes.
* **Instant Sync:** Changes directly update the customer menu interface in real-time.

---

## 🔄 System Architecture Flow
[ Customer Menu ] ──► [ Smart Cart Calculation ] ──► [ WhatsApp Deep-Link ]
│
▼
[ Store Owner's WhatsApp ]
(Instant Order Dispatch)
---
## 🛠️ Tech Stack & Dependencies

* **Frontend:** HTML5, CSS3 (Flexbox/Grid), JavaScript ES6+
* **State Management:** Browser LocalStorage & Modern DOM API
* **Order Delivery:** Universal WhatsApp Deep-Linking (`wa.me API`)
* **Deployment & Hosting:** GitHub Pages

---

## 🚀 Local Setup & Installation

1. **Clone the Repository:**
   ```bash
   git clone [https://github.com/kalaivani-m-131005/smart-menu-system.git](https://github.com/kalaivani-m-131005/smart-menu-system.git)
