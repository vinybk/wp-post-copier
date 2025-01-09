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

// Helper: Clean Up Weird Characters
function cleanText(content) {
  const originalContent = content;

  // Expanded regex to catch more encoding artifacts
  const cleanedContent = content
    .replace(/âž¡|â†’/g, '->')   // Arrow symbols
    .replace(/âœ”/g, '✔')       // Checkmarks
    .replace(/â€™/g, "'")        // Apostrophe
    .replace(/â€œ/g, '“')       // Opening double quote
    .replace(/â€/g, '”')       // Closing double quote
    .replace(/â€¢/g, '•')        // Bullet point
    .replace(/â€“/g, '-')        // En dash
    .replace(/â€”/g, '—')        // Em dash
    .replace(/â€¦/g, '...')      // Ellipsis
    .replace(/â€Š/g, ' ')        // Thin space
    .replace(/â€ /g, '')         // Miscellaneous artifacts
    .replace(/Â/g, '');          // Miscellaneous artifacts
    
  // Log a simple message if any replacements were made
  if (verbose && originalContent !== cleanedContent) {
    console.log('🛠️ Found encoding issues, cleaning up weird characters.');
  }

  return cleanedContent;
}

// Replace WeDistribute Links with WP_SITE_URL Links (Sequential Processing)
async function replaceWeDistributeLinks(content, config) {
  const $ = cheerio.load(content);

  const links = $('a[href*="wedistribute.org"]');
  if (!links.length) {
    return content;  // Return original content if no links to replace
  }

  for (const link of links) {
    const $link = $(link);
    const originalHref = $link.attr('href');

    if (originalHref) {
      // Parse the URL to extract the path without query params
      const urlObj = new URL(originalHref);
      const slug = urlObj.pathname.split('/').filter(Boolean).pop();
      const wpUrl = `${config.WP_SITE_URL}/${slug}`;  // Avoid double /posts

      try {
        // Check if the post exists on WP_SITE_URL
        const response = await axios.get(wpUrl);
        if (response.status === 200) {
          // Replace the link if the post exists
          $link.attr('href', wpUrl);
          logVerbose(`🔗 Replaced link: ${originalHref} -> ${wpUrl}`);
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          logVerbose(`⚠️ No matching post found for: ${originalHref} (Checked: ${wpUrl})`);
        } else {
          logError(`❌ Error checking link (${slug}): ${error.message}`);
        }
      }
    }
  }

  return $.html();  // Return modified HTML content
}




// 2. Extract Post Details (Title, Content, Image)
async function extractPostDetails(originalPost,postUrl) {
  const $ = cheerio.load(originalPost);

  // Remove Table of Contents (updated selector)
  $('div.simpletoc.wp-block-simpletoc-toc').remove();

  // Remove Share Section
  $('div.shareopenly').remove();

  // Remove Share Section
  $('div.sharedaddy').remove();
  
  // Extract Tags
  const tags = [];
  $('div.post-tags-modern a[rel="tag"]').each((_, element) => {
    const tag = $(element).text().trim();
    if (tag) {
      tags.push(tag);
    }
  });

  // Remove Tag Section from Content
  $('div.post-tags-modern').remove();

    // Extract Title
  const postTitle = $('h1.entry-title').text().trim() || 
                    $('meta[property="og:title"]').attr('content') || 
                    $('title').text() || 
                    'Untitled Post';

  // Extract Article Content from div.entry-content
  let postContent = $('div.entry-content').html() || 
                      '<p>No content found</p>';

  // Clean up unwanted characters from content
  postContent = cleanText(postContent);

  // Replace WeDistribute Links with WP_SITE_URL Links
  postContent = await replaceWeDistributeLinks(postContent, config);

  // Extract Featured Image (Fallback to first image if meta is missing)
  let imageUrl = $('meta[property="og:image"]').attr('content');
  if (!imageUrl) {
      imageUrl = $('div.entry-content img').first().attr('src') || null;
  }
  
  // Extract Post Date
  let postDate = $('time.entry-date').attr('datetime');
  if (!postDate) {
    // Attempt alternative methods if the primary method fails
    postDate = $('meta[property="article:published_time"]').attr('content') ||
               $('meta[name="pubdate"]').attr('content') ||
               $('time').attr('datetime') ||
               new Date().toISOString(); // Fallback to current date
  }

  // Extract Slug from URL
  const slug = postUrl.split('/').filter(Boolean).pop() || 
                postTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

  // Log extraction for debugging
  logVerbose(`Extracted Title: ${postTitle}`);
  logVerbose(`Image URL: ${imageUrl || 'No image found'}`);
  logVerbose(`Extracted slug: ${slug}`);
  logVerbose(`Extracted Date: ${postDate}`);
  logVerbose(`Tags: ${tags.join(', ')}`);

  return { postTitle, postContent, imageUrl, slug, postDate, tags };
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

// Helper: Get or Create Tags in WordPress
async function getOrCreateTags(tags, config) {
  const tagIds = [];

  for (const tag of tags) {
    try {
      // Search for existing tag
      const response = await axios.get(`${config.WP_API_BASE}/tags`, {
        params: { search: tag },
        auth: {
          username: config.WP_USER,
          password: config.WP_APP_PASSWORD,
        },
      });

      if (response.data.length > 0) {
        const existingTagId = response.data[0].id;
        logVerbose(`✅ Found existing tag: ${tag} (ID: ${existingTagId})`);
        tagIds.push(existingTagId);
      } else {
        // Create tag if it doesn't exist
        const createResponse = await axios.post(`${config.WP_API_BASE}/tags`, {
          name: tag,
        }, {
          auth: {
            username: config.WP_USER,
            password: config.WP_APP_PASSWORD,
          },
        });

        const newTagId = createResponse.data.id;
        logVerbose(`🆕 Created new tag: ${tag} (ID: ${newTagId})`);
        tagIds.push(newTagId);
      }
    } catch (error) {
      logError(`❌ Error creating/fetching tag: ${tag} - ${error.message}`);
    }
  }

  return tagIds;
}

  
// Global Counter for Created Posts
let postsCreated = 0;

// 4. Create the Post in WordPress (with logging for date issues)
async function createPost(title, content, featuredImageId, slug, postDate, tags, config) {
  const tagIds = await getOrCreateTags(tags, config);  // Ensure we pass IDs

  const postData = {
    title,
    content,
    status: 'draft',
    featured_media: featuredImageId,
    categories: [config.CATEGORY_ID],
    author: config.AUTHOR_ID,
    date: postDate,  // Set post date to match original
    excerpt: 'Syndicated post from We Distribute.',
    slug: slug,
    tags: tagIds,  // Pass array of tag IDs, not names
  };

  try {
    logVerbose(`Submitting new post: ${title}`);
    logVerbose(`Post Date: ${postDate}`);
    logVerbose(`Tags: ${tags.join(', ')}`);

    const response = await axios.post(`${config.WP_API_BASE}/posts`, postData, {
      auth: {
        username: config.WP_USER,
        password: config.WP_APP_PASSWORD,
      },
    });

    const truncatedResponse = JSON.stringify(response.data, null, 2).substring(0, 300) + '...';
    logVerbose(`Post Creation Response (truncated): ${truncatedResponse}`);

    console.log(`✅ Post Created: ${response.data.link}`);
    fs.appendFileSync('post-log.txt', `${response.data.link}\n`);

    // Increment Counter
    postsCreated++;
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

// 1. Check if Post or Draft Exists (Avoid Duplication of /posts)
async function checkIfPostExists(slug, config) {
  const postUrl = `${config.WP_SITE_URL}/${slug}`;  // Avoid double /posts

  try {
    // Check Published Post
    const response = await axios.get(postUrl);
    if (response.status === 200) {
      logVerbose(`🟡 Post already exists (Published): ${slug}`);
      return true;
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logVerbose(`✅ Published post not found: ${slug}`);
    } else {
      logError(`❌ Error checking post existence (${slug}): ${error.message}`);
      return false;
    }
  }

  // Check for Drafts in WordPress
  try {
    const draftResponse = await axios.get(`${config.WP_API_BASE}/posts`, {
      params: {
        slug: slug,
        status: 'draft'
      },
      auth: {
        username: config.WP_USER,
        password: config.WP_APP_PASSWORD,
      }
    });

    if (draftResponse.data.length > 0) {
      logVerbose(`🟡 Draft already exists: ${slug}`);
      return true;
    }
  } catch (error) {
    logError(`❌ Error checking draft (${slug}): ${error.message}`);
  }

  logVerbose(`✅ No draft found: ${slug}`);
  return false;
}



// Process Single Post or List
async function processPost(url, config) {
  const originalPost = await fetchOriginalPost(url);
  if (!originalPost) return;

  const extracted = await extractPostDetails(originalPost, url);
  if (!extracted) {
    logError(`❌ Post content not found for URL.`);
    return;
  }

  const { postTitle, postContent, imageUrl, slug, postDate, tags } = extracted;

  // Check if post or draft exists
  const exists = await checkIfPostExists(slug, config);
  if (exists) {
    logVerbose(`⏭️ Skipping post creation: ${postTitle} (Slug: ${slug})`);
    return;
  }

  logVerbose(`Processing post: ${postTitle}`);
  let featuredImageId = null;

  if (imageUrl) {
    featuredImageId = await uploadImageToWordPress(imageUrl, config);
  }

  await createPost(postTitle, postContent, featuredImageId, slug, postDate, tags, config);
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

// End of Execution - Print Summary
async function main() {
  if (url) {
    await processPost(url, config);
  } else if (fs.existsSync(listFile)) {
    const urls = fs.readFileSync(listFile, 'utf-8').split('\n').filter(Boolean);
    for (const postUrl of urls) {
      await processPost(postUrl, config);
    }
  } else {
    logError('No URL or list file provided. Exiting...');
    process.exit(1);
  }

  // Final Summary
  console.log(`\n📝 ${postsCreated} post(s) created.`);
}

// Start Main Process
main();