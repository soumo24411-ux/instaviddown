// netlify/functions/instagram-download.js
// VOIDGRAB - SocialKit API Integration

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { url } = JSON.parse(event.body);

    if (!url || !url.includes("instagram.com")) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Valid Instagram URL dalo" }),
      };
    }

    // SocialKit API call
    const response = await fetch("https://api.socialkit.dev/instagram/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_key: "uXbW2cWuYmzxMc", // ⚠️ Regenerate this key from socialkit.dev dashboard!
        url: url,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: data.error || "Download failed. URL check karo." }),
      };
    }

    // SocialKit response se media extract karo
    // Response mein: data.url (video), data.thumbnail, data.type, data.formats[]
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        type: data.type || "video",           // "video" or "image"
        url: data.url || null,                 // Direct video/image URL
        thumbnail: data.thumbnail || null,     // Thumbnail image
        formats: data.formats || [],           // Multiple quality options
        title: data.title || "Instagram Media",
      }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error: " + error.message }),
    };
  }
};
