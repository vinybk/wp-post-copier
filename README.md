# 📰 WordPress Post Copier  
Automate syndication of articles from external websites to your WordPress site using the WordPress REST API. Perfect for content aggregation, cross-posting, and syndicating posts (with proper permissions).

---

## 🚀 Features  
- **Fetches and Parses HTML** from external posts  
- **Extracts Title, Content, and Featured Image**  
- **Uploads Media** to WordPress via REST API  
- **Creates Draft Posts** with original metadata  
- **Preserves Original Slug** for URL consistency  
- **Handles Tags/Categories Dynamically**  

---

## 🛠️ Requirements  
- Node.js v18+  
- WordPress (with REST API enabled)  
- App Password for WordPress User (for authentication)  
- Axios, Cheerio, Form-Data (npm packages)  

---

## 🛠️ Setup  
### 1. Clone the Repository  
~~~bash
git clone https://github.com/yourusername/wp-post-copier.git
cd wp-post-copier
~~~

### 2. Install Dependencies  
~~~bash
npm install
~~~

### 3. Create Config File  
Create a file named `wp-login.config` in the root directory.  
~~~ini
WP_SITE_URL = 'https://yoursite.com'
WP_API_BASE = 'https://yoursite.com/wp-json/wp/v2'
WP_USER = 'your-username'
WP_APP_PASSWORD = 'your-app-password'
AUTHOR_ID = 7
CATEGORY_ID = 12
~~~

---

## ▶️ How to Use  

### 1. Single Post  
Fetch and copy a single post by passing the URL:  
~~~bash
node wp-post-copier.js https://example.com/post-url
~~~

### 2. Batch Processing  
Create a list of URLs in `posts.list` (one per line):  
~~~txt
https://example.com/post1
https://example.com/post2
~~~
Run:  
~~~bash
node wp-post-copier.js -l posts.list
~~~

### 3. Enable Verbose Mode (Debugging)  
~~~bash
node wp-post-copier.js -v https://example.com/post-url
~~~

---

## 🖼️ Uploading Images  
The script will fetch and upload the **featured image** from the source post. If no image is found, the post will be created without one.  

---

## 📋 Notes  
- **Slug Preservation** – The slug of the original post is maintained to match URLs.  
- **Draft Mode** – Posts are created as **drafts** by default. You can manually publish them.  
- **Tag/Category Handling** – If tags don't exist, the script creates them.  

---

## 🔧 Troubleshooting  
### Common Issues:  
- **403 Forbidden (During Upload)**  
  - Ensure the app password has **upload media permissions**.  
  - Check user roles (author/editor).  

- **Invalid Parameters (author, categories, tags)**  
  - Verify `AUTHOR_ID` and `CATEGORY_ID` exist using:  
    ~~~bash
    curl -u user:app-password https://yoursite.com/wp-json/wp/v2/users
    curl -u user:app-password https://yoursite.com/wp-json/wp/v2/categories
    ~~~

- **Image Upload Fails**  
  - Add `https://` to image URLs if missing.  
  - Ensure images are not too large (WordPress max upload size).  

---

## 📜 License  
MIT License  

---

## 🤝 Contributing  
Pull requests are welcome! For major changes, please open an issue to discuss.  

---

### 🎉 Happy Posting!
