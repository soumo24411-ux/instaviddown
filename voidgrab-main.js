// VOIDGRAB - Main Frontend Script
// Apne existing HTML mein yeh script add karo

async function downloadMedia() {
  const urlInput = document.getElementById("ig-url").value.trim();
  const resultDiv = document.getElementById("result");
  const btn = document.getElementById("download-btn");

  if (!urlInput) {
    showError("Instagram URL paste karo pehle!");
    return;
  }

  // Loading state
  btn.disabled = true;
  btn.innerText = "Processing...";
  resultDiv.innerHTML = `<p class="loading">Fetching media... ⏳</p>`;

  try {
    const response = await fetch("/.netlify/functions/instagram-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlInput }),
    });

    const data = await response.json();

    if (!data.success) {
      showError(data.error || "Kuch galat hua, dobara try karo.");
      return;
    }

    // Result display
    if (data.type === "video") {
      resultDiv.innerHTML = `
        <div class="media-result">
          ${data.thumbnail ? `<img src="${data.thumbnail}" alt="Thumbnail" class="thumb" />` : ""}
          
          <video controls playsinline style="width:100%; max-width:480px; border-radius:12px; margin:12px 0;">
            <source src="${data.url}" type="video/mp4">
            Browser mein play nahi hua.
          </video>

          <div class="download-btns">
            <a href="${data.url}" download="voidgrab_video.mp4" target="_blank" class="dl-btn">
              ⬇️ Download Video
            </a>
            ${data.formats && data.formats.length > 1 ? data.formats.map(f => `
              <a href="${f.url}" download target="_blank" class="dl-btn secondary">
                ⬇️ ${f.quality || f.label || "Alternative"}
              </a>
            `).join("") : ""}
          </div>
        </div>
      `;
    } else {
      // Image post
      resultDiv.innerHTML = `
        <div class="media-result">
          <img src="${data.url}" alt="Instagram Image" style="width:100%; max-width:480px; border-radius:12px;" />
          <div class="download-btns">
            <a href="${data.url}" download="voidgrab_image.jpg" target="_blank" class="dl-btn">
              ⬇️ Download Image
            </a>
          </div>
        </div>
      `;
    }

  } catch (err) {
    showError("Network error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Download";
  }
}

function showError(msg) {
  document.getElementById("result").innerHTML = `<p class="error">❌ ${msg}</p>`;
  document.getElementById("download-btn").disabled = false;
  document.getElementById("download-btn").innerText = "Download";
}

// Enter key support
document.getElementById("ig-url")?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") downloadMedia();
});
