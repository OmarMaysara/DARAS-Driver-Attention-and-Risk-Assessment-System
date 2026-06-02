import https from "https";

const url = "https://unwistful-doleritic-elissa.ngrok-free.dev/api/v1/dashboard/employer/reports?employer_id=999999";

https.get(url, { headers: { "ngrok-skip-browser-warning": "true" } }, (res) => {
  let data = "";
  res.on("data", (chunk) => { data += chunk; });
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Body:", data);
  });
}).on("error", (err) => {
  console.log("Error:", err.message);
});
