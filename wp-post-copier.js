import axios from 'axios';
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import fs from 'fs';

// Verbose Mode Flag
let verbose = false;

// Helper: Load Configuration from .config File
function loadConfig(configPath) {
  try {
    logVerbose(`Loading config from: ${configPath}`);
    const config = fs.readFileSync(configPath, 'utf-8');
    const configObject = {};
    config.split('\n').forEach((line) => {
      if (line.trim() && line.includes('=')) {
        const [key, value] = line.split('=');
        configObject[key.trim()] = value.trim().replace(/['";]+/g, '');
      }
    });
    logVerbose('Config loaded successfully (Non-sensitive info only).');
    logVerbose(`Site URL: ${configObject.WP_SITE_URL}`);
    logVerbose(`Author ID: ${configObject.AUTHOR_ID}`);
    logVerbose(`Category ID: ${configObject.CATEGORY_ID}`);
    return configObject;
  } catch (error) {
    logError(`Error loading config file (${configPath}): ${error.message}`);
    process.exit(1);
  }
}

// 1. Fetch the Original Post
async function fetchOriginalPost(url) {
    try {
      logVerbose(`Fetching post from URL: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'Accept': 'text/html;q=1.0,*/*;q=0.8',  // Strong HTML preference
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        responseType: 'text'  // Force response as text
    });
    

      logVerbose(`Fetched HTML content (truncated): ${response.data.substring(0, 200)}...`);
      return response.data;  // Return HTML content for parsing with Cheerio
    } catch (error) {
      logError(`❌ Failed to fetch post: ${url} - ${error.message}`);
      return null;
    }
}


  // 2. Extract Post Details (Title, Content, Image)
// 2. Extract Post Details (Title, Content, Image)
function extractPostDetails(originalPost,postUrl) {
    const $ = cheerio.load(originalPost);

    // Extract Title
    const postTitle = $('h1.entry-title').text().trim() || 
                      $('meta[property="og:title"]').attr('content') || 
                      $('title').text() || 
                      'Untitled Post';

    // Extract Article Content from div.entry-content
    const postContent = $('div.entry-content').html() || 
                        '<p>No content found</p>';
  
    // Extract Featured Image (Fallback to first image if meta is missing)
    let imageUrl = $('meta[property="og:image"]').attr('content');
    if (!imageUrl) {
        imageUrl = $('div.entry-content img').first().attr('src') || null;
    }
    
    // Extract Post Date and Author (Optional)
    const postDate = $('time.entry-date').attr('datetime') || 
                     new Date().toISOString();
    const postAuthor = $('span.author').text().trim() || 'We Distribute';


    // Extract Slug from URL
    const slug = postUrl.split('/').filter(Boolean).pop() || 
                 postTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

    // Log extraction for debugging
    logVerbose(`Extracted Title: ${postTitle}`);
    logVerbose(`Image URL: ${imageUrl || 'No image found'}`);
    logVerbose(`Post Date: ${postDate}`);
    logVerbose(`Author: ${postAuthor}`);
    logVerbose(`Extracted slug: ${slug}`);
    return { postTitle, postContent, imageUrl, slug };
}

  
// 3. Upload Featured Image
async function uploadImageToWordPress(imageUrl, config) {
    try {
      logVerbose(`Downloading image: ${imageUrl}`);
      
      // Fetch the image as binary
      const image = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(image.data);
      
      // Extract filename from URL
      const fileName = imageUrl.split('/').pop() || 'Untitled.jpeg';
      const mimeType = image.headers['content-type'] || 'image/jpeg';
      
      // Prepare FormData
      const form = new FormData();
      form.append('file', buffer, { filename: fileName, contentType: mimeType });
      
      // Manually set Content-Disposition like in Postman
      const headers = {
        ...form.getHeaders(),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Type': mimeType,
      };
      
      // Log for debugging
      logVerbose(`Uploading image to: ${config.WP_SITE_URL}`);
      
      // Perform the upload request
      const response = await axios.post(`${config.WP_API_BASE}/media`, form, {
        auth: {
          username: config.WP_USER,
          password: config.WP_APP_PASSWORD,
        },
        headers,
      });
  
      // Handle response
      if (response.data && response.data.source_url) {
        logVerbose(`✅ Image uploaded successfully! URL: ${response.data.source_url}`);
        return response.data.id;
      } else {
        throw new Error('Image upload succeeded but no source URL returned.');
      }
    } catch (error) {
      if (error.response) {
        logError(`❌ Upload failed. Status: ${error.response.status}`);
        logError(`Response: ${JSON.stringify(error.response.data, null, 2)}`);
      } else {
        logError(`❌ Failed to upload image: ${error.message}`);
      }
      return null;
    }
}
  

// 4. Create the Post in WordPress
async function createPost(title, content, featuredImageId, slug, config) {
  const postData = {
    title,
    content,
    status: 'draft',
    featured_media: featuredImageId,
    categories: [config.CATEGORY_ID],
    author: config.AUTHOR_ID,
    excerpt: 'Syndicated post from We Distribute.',
    slug: slug,
  };

  try {
    logVerbose(`Submitting new post: ${title}`);
    logVerbose(`Post Data (Truncated): ${JSON.stringify(postData, null, 2).substring(0, 300)}...`);
    const response = await axios.post(`${config.WP_API_BASE}/posts`, postData, {
      auth: {
        username: config.WP_USER,
        password: config.WP_APP_PASSWORD,
      },
    });

    console.log(`✅ Post Created: ${response.data.link}`);
    fs.appendFileSync('post-log.txt', `${response.data.link}\n`);
  } catch (error) {
    const errorMessage = error.response
      ? `❌ Failed to create post: ${title} - ${error.response.data.message}`
      : `❌ Failed to create post: ${title} - Unknown error`;
    logError(errorMessage);
    fs.appendFileSync('post-log.txt', `Failed: ${title}\n`);
  }
}

// Error Logging Helper
function logError(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.error(logMessage);
  fs.appendFileSync('error-log.txt', logMessage);
}

// Verbose Logging Helper
function logVerbose(message) {
  if (verbose) {
    console.log(message);
  }
}

// Main Process
async function processPost(url, config) {
  const originalPost = await fetchOriginalPost(url);
  if (!originalPost) return;

  const extracted = extractPostDetails(originalPost,url);
  if (!extracted) {
      logError(`❌ Post content not found for URL.`);
      return;  // Stop further processing if extraction fails
  }
  const { postTitle, postContent, imageUrl, slug } = extracted;
  

  logVerbose(`Processing post: ${postTitle}`);
  let featuredImageId = null;

  if (imageUrl) {
    featuredImageId = await uploadImageToWordPress(imageUrl, config);
  }

  await createPost(postTitle, postContent, featuredImageId, slug, config);
}

// CLI Argument Handling
const args = process.argv.slice(2);
let url = null;
let listFile = 'posts.list';
let configFile = 'wp-login.config';
let invalidArgument = false;

// Parse Arguments
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-h':
    case '--help':
      displayHelp();
      process.exit(0);

    case '-v':
    case '--verbose':
      verbose = true;
      break;

    case '-l':
    case '--list':
      if (args[i + 1]) {
        listFile = args[i + 1];
        i++;  // Skip next argument (already consumed)
      } else {
        console.error('❌ Error: Missing file path after --list.');
        console.log('You can check the help menu at --help.');
        process.exit(1);
      }
      break;

    case '-c':
    case '--config':
      if (args[i + 1]) {
        configFile = args[i + 1];
        i++;
      } else {
        console.error('❌ Error: Missing config path after --config.');
        console.log('You can check the help menu at --help.');
        process.exit(1);
      }
      break;

    default:
      if (args[i].startsWith('http')) {
        url = args[i];  // Assume URL is passed directly
      } else {
        console.error(`❌ Unknown argument "${args[i]}".`);
        console.log('You can check the help menu at --help.');
        invalidArgument = true;
      }
  }
}

// Exit if invalid arguments were found
if (invalidArgument) {
  process.exit(1);
}

// Help Menu Function
function displayHelp() {
  console.log(`
  📰 WordPress Post Copier - Help Menu

  Usage:
    node wp-post-copier.js [options] <url>

  Options:
    -h, --help       Show this help message
    -v, --verbose    Enable verbose mode
    -l, --list       Specify a list file with URLs to process
    -c, --config     Specify a custom config file

  Examples:
    node wp-post-copier.js https://example.com/post-url
    node wp-post-copier.js -l posts.list
    node wp-post-copier.js -c wp-custom.config
    node wp-post-copier.js --verbose -l urls.txt
  `);
}

// Check for Config File
if (!fs.existsSync(configFile)) {
  logError(`Config file not found: ${configFile}`);
  process.exit(1);
}

// Load Configuration
const config = loadConfig(configFile);

// Process Single Post or List
if (url) {
  processPost(url, config);
} else if (fs.existsSync(listFile)) {
  const urls = fs.readFileSync(listFile, 'utf-8').split('\n').filter(Boolean);
  for (const postUrl of urls) {
    await processPost(postUrl, config);
  }
} else {
  logError('No URL or list file provided. Exiting...');
  process.exit(1);
}
