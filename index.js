const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  globalShortcut,
  systemPreferences,
} = require("electron");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const { Blob } = require("buffer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const FormData = require("form-data");
const { exec } = require("child_process");
const activeWin = require("active-win");
const Store = require("electron-store");
const buffer = require("buffer");

const store = new Store();
ffmpeg.setFfmpegPath(ffmpegStatic);

// const mysql = require('mysql');
// const connection = mysql.createConnection({
//   host: '106.14.169.64:3310',
//   user: 'root',
//   password: 'qijuzhu001',
//   database: 'database_name'
// });

const redis = require('redis');
const redisClient = redis.createClient();

redisClient.on('connect', function() {
  console.log('Connected to Redis server.');
});

redisClient.on('error', function(err) {
  console.error('Error connecting to Redis server: ' + err);
});

// redisClient.connect().then(res=>{
//   console.log(res)
//   console.log(redisClient.isOpen)
//   console.log(redisClient.isReady)
//   redisClient.set('hello', 'world') // 设置key "hello"的值为"world
//   redisClient.get("hello").then(res=>{
//     console.log(res)
//   })
// }).catch(err =>{
//   console.log(err)
// })

// // //  SET CONFIGS AND PLACEHOLDER VARIABLES // // //

let openAiApiKey = store.get("userApiKey", "");
let ernieApiKey = store.get("ernieApiKey", "");
let openai = new OpenAI({
  apiKey: openAiApiKey,
});


const keyboardShortcut = "CommandOrControl+Shift+'"; // This is the keyboard shortcut that triggers the app

const notificationWidth = 300; // Width of notification window
const notificationHeight = 100; // Height of notification window
const notificationOpacity = 0.8; // Opacity of notification window
const mainWindowWidth = 600; // Width of main window
const mainWindowHeight = 400; // Height of main window

let isRecording = false;
let mainWindow;
let notificationWindow;

// 我来向广大网友道歉 前天我直播解释东方甄选问题的时候 从神态语气表达都有点咄咄逼人 
// 把手机放在桌上的动作也好像摔下去的样子 这种样子非常没有风度和气度
//  让广大网友误以为是十分不敬的粗暴行为 
// 尽管是因为连续几天没有休息 内心焦虑导致了动作僵硬和失控 但这不是理由 我在这里真诚道歉 
// 以下道歉存在什么样的问题 并给出相应的解决方案

let conversationHistory = [
  {
    role: "system",
    content:
      "东方甄选（港交所：1797）是2021年12月28日新东方学校下属新东方在线推出的直播销售平台，定位于助农项目直播平台，\
      新东方创始人俞敏洪与新东方在线CEO孙东旭分别在俞敏洪个人抖音直播间与东方甄选直播间销售农产品，专业的主播.\
      请分析以下的直播画面和表达内容，有什么不合适的地方，并且给出更加合适的方案",
  },
];

// Set to true if you intend to package the app, otherwise false.
const useElectronPackager = false;
let tempFilesDir;
// This decides what directory/storage strategy to use (local project or application folder)
if (useElectronPackager) {
  tempFilesDir = path.join(app.getPath("userData"), "macOSpilot-temp-files");
} else {
  tempFilesDir = path.join(__dirname, "macOSpilot-temp-files");
}

if (!fs.existsSync(tempFilesDir)) {
  fs.mkdirSync(tempFilesDir, { recursive: true });
}

const micRecordingFilePath = path.join(tempFilesDir, "macOSpilotMicAudio.raw");
const mp3FilePath = path.join(tempFilesDir, "macOSpilotAudioInput.mp3");
const screenshotFilePath = path.join(tempFilesDir, "macOSpilotScreenshot.png");
const audioFilePath = path.join(tempFilesDir, "macOSpilotTtsResponse.mp3");
const vedioFilePath = path.join(tempFilesDir, "vedio.mp4");
// // // // // // // // // // // // // // // // // // // // //

// Create main Electron window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: mainWindowWidth,
    height: mainWindowHeight,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile("index.html");
}

// Create "always on top" Electron notification window
function createNotificationWindow() {
  notificationWindow = new BrowserWindow({
    width: notificationWidth,
    height: notificationHeight,
    frame: false,
    transparent: true, // Enable transparency
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    alwaysOnTop: true,
    skipTaskbar: true,
    x: 100,
    y: 100,
  });
  notificationWindow.setOpacity(notificationOpacity);
  notificationWindow.loadFile("notifications.html");
}

// Function to re-position "always on top" notification window when a new active window is used
function repositionNotificationWindow(selectedWindow) {
  // Calculate top-right position which is what's currently used
  const topRightX =
    selectedWindow.bounds.x + selectedWindow.bounds.width - notificationWidth;
  const topRightY = selectedWindow.bounds.y;

  // Ensure the window is not positioned off-screen
  const safeX = Math.max(topRightX, 0);
  const safeY = Math.max(topRightY, 0);

  // Set the position of the notification window
  // Currently set to 15px in form the right-hand corner of the active window
  if (notificationWindow) {
    notificationWindow.setPosition(safeX - 15, safeY + 15);
  }
}

// Manage API key storage/access
ipcMain.on("submit-api-key", (event, apiKey) => {
  store.set("userApiKey", apiKey); // Directly saving the API key using electron-store
});

// Function to mask the API key except for the last 4 characters
function maskApiKey(apiKey) {
  if (apiKey.length <= 4) {
    return apiKey; // If the key is too short, just return it
  }
  return "*".repeat(apiKey.length - 4) + apiKey.slice(-4);
}

// Handle request for API key
ipcMain.on("request-api-key", (event) => {
  const apiKey = store.get("userApiKey", ""); // Get the API key
  const maskedApiKey = maskApiKey(apiKey); // Get the masked version
  event.reply("send-api-key", maskedApiKey); // Send the masked key
});

// fetch the key to send to backend logic
ipcMain.handle("get-api-key", (event) => {
  return store.get("userApiKey", "");
});

// Recorded audio gets passed to this function when the microphone recording has stopped
ipcMain.on("audio-buffer", (event, buffer) => {
  // Calling this in case the user added
  openAiApiKey = store.get("userApiKey", "");
  openai = new OpenAI({
    apiKey: openAiApiKey,
  });

  // Save buffer to the temporary file
  fs.writeFile(micRecordingFilePath, buffer, (err) => {
    if (err) {
      console.error("Failed to save temporary audio file:", err);
      return;
    }

    // Convert the temporary file to MP3 and send to Vision API
    try {
      ffmpeg(micRecordingFilePath)
        .setFfmpegPath(ffmpegStatic)
        .audioBitrate(32)
        .toFormat("mp3")
        .on("error", (err) => {
          console.error("Error converting to MP3:", err);
        })
        .on("end", async () => {
          fs.unlink(micRecordingFilePath, (err) => {
            if (err) console.error("Failed to delete temporary file:", err);
          });
          // Send user audio recording to OpenAI Whisper API for transcription
          const audioInput = await transcribeUserRecording(mp3FilePath);

          // Set a default response and call the Vision API to overwrite it if we have a transcription of the user recording
          let visionApiResponse = "There was an error calling OpenAI.";
          if (audioInput) {
            // Call Vision API with screenshot and transcription of question
            visionApiResponse = await callVisionAPI(
              screenshotFilePath,
              audioInput
            );
          }

          // Update both windows with the response text
          mainWindow.webContents.send(
            "push-vision-response-to-windows",
            visionApiResponse
          );
          notificationWindow.webContents.send(
            "push-vision-response-to-windows",
            visionApiResponse
          );

          // Call function to generate and playback audio of the Vision API response
          await playVisionApiResponse(visionApiResponse);
        })
        .save(mp3FilePath);
    } catch (error) {
      console.log(error);
    }
  });
});

ipcMain.on("vedio-buffer",(event, buffer) =>{
  // const outputPath = path.resolve(__dirname, 'recording.webm'); // 设置输出路径
  fs.writeFile(vedioFilePath, buffer, (err) => { // 将视频数据写入文件
    if (err) {
      console.error('Error saving video file:', err);
    } else {
      console.log('Video saved to:', vedioFilePath);
    }
  });
})

ipcMain.on("save-vedio-frame",(event, buffer) =>{
  const outputFramePath = path.join(tempFilesDir, `frame_${Date.now()}.png`); // 自定义保存路径和文件名，这里保存为 PNG 图片文件，你可以根据需要修改为其他格式或处理方式
  fs.writeFile(outputFramePath, buffer, (err) => { // 将视频数据写入文件
    if (err) {
      console.error('Error saving video file:', err);
    } else {
      // 将帧数据写入文件
      console.log(`saved to ${outputFramePath}`); // 输出保存路径和帧编号，便于调试和跟踪录制状态和进度
    }
  });
})

ipcMain.on('save-video', async (event, blob) => {
  try {
    // 将 Blob 对象转换为 Buffer，以便使用 fs 模块写入文件
    const buffer = Buffer.from(await blob.arrayBuffer());
    const outputPath = path.join(tempFilesDir, `video_${Date.now()}.webm`); // 自定义保存路径和文件名
    await fs.writeFile(outputPath, buffer); // 将数据写入文件
    event.reply('video-saved', outputPath); // 可选：回复渲染进程文件已保存的消息和路径
  } catch (error) {
    console.error('Error saving video:', error);
  }
});

// Capture a screenshot of the selected window, and save it to disk
async function captureWindow(windowName) {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  // Not been able to use window IDs successfully, so have to rely on names
  const selectedSource = sources.find((source) => source.name === windowName);

  if (!selectedSource) {
    console.error("Window not found:", windowName);
    return "Window not found";
  }

  // Capture and save the thumbnail of the window
  const screenshot = selectedSource.thumbnail.toPNG();
  fs.writeFile(screenshotFilePath, screenshot, async (err) => {
    if (err) {
      throw err;
    }
  });
  return "Window found";
}

// Function to send audio file of user recording and return a transcription
async function transcribeUserRecording(mp3FilePath) {
  try {
    const form = new FormData();

    form.append("file", fs.createReadStream(mp3FilePath));
    form.append("model", "whisper-1");
    form.append("response_format", "text");
    // form.append("prompt", "add", "words", "it", "usually", "gets", "wrong"); // Append correction words if needed
    response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${openAiApiKey}`,
        },
      }
    );
    console.log(response.data);

    // Adding user's question to windows to give sense of progress
    notificationWindow.webContents.send(
      "push-transcription-to-windows",
      response.data
    );

    mainWindow.webContents.send("push-transcription-to-windows", response.data);

    return response.data;
  } catch (error) {
    console.error("Error calling OpenAI:", error);
    return false;
  }
}

// Function to call the Vision API with the screenshot and transcription of the user question
async function callVisionAPI(inputScreenshot, audioInput) {
  const base64Image = fs.readFileSync(inputScreenshot).toString("base64");
  const dataUrl = `data:image/png;base64,${base64Image}`;
  const userMessage = {
    role: "user",
    content: [
      { type: "text", text: audioInput },
      {
        type: "image_url",
        image_url: {
          url: dataUrl,
        },
        // OPTION TO RESIZE
        //   {
        //     image: base64Image,
        //     resize: 1024, // Can be changed, smaller = less quality
        //   },
      },
    ],
  };

  conversationHistory.push(userMessage);

  try {
    const response = await openai.chat.completions.create({
      max_tokens: 850,
      model: "gpt-4-vision-preview",
      messages: conversationHistory,
    });

    const responseContent = response.choices[0].message.content;

    conversationHistory.push({
      role: "assistant",
      content: responseContent,
    });

    return responseContent;
  } catch (error) {
    console.log(error);
  }
}

// Function that takes text input, calls TTS API, and plays back the response audio
async function playVisionApiResponse(inputText) {
  const url = "https://api.openai.com/v1/audio/speech";
  const voice = "echo"; // you can change voice if you want
  const model = "tts-1";
  const headers = {
    Authorization: `Bearer ${openAiApiKey}`, // API key for authentication
  };

  const data = {
    model: model,
    input: inputText,
    voice: voice,
    response_format: "mp3",
  };

  try {
    const response = await axios.post(url, data, {
      headers: headers,
      responseType: "stream",
    });

    // Save the response stream to a file
    const writer = fs.createWriteStream(audioFilePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    }).then(() => {
      // Play the audio file using a system command
      let playCommand;
      switch (process.platform) {
        case "darwin": // macOS
          playCommand = `afplay "${audioFilePath}"`;
          break;
        case "win32": // Windows
          playCommand = `start "${audioFilePath}"`;
          break;
        case "linux": // Linux (requires aplay or mpg123 or similar to be installed)
          playCommand = `aplay "${audioFilePath}"`; // or mpg123, etc.
          break;
        default:
          console.error("Unsupported platform for audio playback");
          return;
      }

      // exec(playCommand, (error) => {
      //   if (error) {
      //     console.error("Failed to play audio:", error);
      //   } else {
      //   }
      // });
      // https://www.douyin.com/search/%E4%B8%9C%E6%96%B9%E5%B0%8F%E5%AD%99%E6%91%94%E6%89%8B%E6%9C%BA%E8%A7%86%E9%A2%91%E5%AE%8C%E6%95%B4%E7%89%88%E6%A8%AA%E5%B1%8F?modal_id=7312635144915946790&publish_time=0&sort_type=0&source=switch_tab&type=video
      const playTime = 10000; // 播放时间为10秒
      const childProcess = exec(playCommand, (error) => {
        if (error) {
          console.error("Failed to play audio:", error);
        }
      });

      // 在播放时间到达后停止播放
      const timeout = setTimeout(() => {
        childProcess.kill();  // 终止子进程
      }, playTime);

      // 监听子进程的退出事件，确保在播放完成前就停止定时器
      childProcess.on('exit', () => {
        clearTimeout(timeout);
      });
    });
  } catch (error) {
    if (error.response) {
      console.error(
        `Error with HTTP request: ${error.response.status} - ${error.response.statusText}`
      );
    } else {
      console.error(`Error in streamedAudio: ${error.message}`);
    }
  }
}

async function callErnieApi(audioInput){
  return new Promise((resolve, reject)=>{
    let command = "export EB_API_TYPE=\"aistudio\";export EB_ACCESS_TOKEN=\"474fda1b284216a77ffd5d9a07501b2173337dca\";" +
        "erniebot api chat_completion.create --model ernie-bot --message user " + audioInput;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.log(`error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
        reject()
        return;
      }
      console.log(`stdout: ${stdout}`);
      resolve(stdout)
    });
  });
}

// Run when Electron app is ready
app.whenReady().then(() => {
  createMainWindow();
  createNotificationWindow();
  // link redis db
  // redisClient = redis.createClient({
  //   host: '106.14.169.64',
  //   port: 7000,
  //   password: 'qijuzhu001',
  //   db: 0
  // });

  // redisClient.connect().then(res=>{
  //   console.log(res)
  // }).catch(err =>{
  //   console.log(err)
  // })

  // Request microphone access
  systemPreferences.askForMediaAccess('microphone').then(accessGranted => {
    if (accessGranted) {
      console.log('Microphone access granted');
    } else {
      console.log('Microphone access denied');
    }
  }).catch(err => {
    console.error('Error requesting microphone access:', err);
  });

  // 请求摄像头权限
  systemPreferences.askForMediaAccess('camera').then((granted) => {
    if (granted) {
      console.log('摄像头权限已授予');
      // 在这里编写使用摄像头的代码
    } else {
      console.log('摄像头权限被拒绝');
    }
  });
  // This call initializes MediaRecorder with an 500ms audio recording, to get around an issue seen on some machines where the first user-triggered recording doesn't work.
  mainWindow.webContents.send("init-mediaRecorder");
  // mainWindow.webContents.send("init-vedioRecorder");

  // If defined keyboard shortcut is triggered then run
  globalShortcut.register(keyboardShortcut, async () => {
    // If the microphone recording isn't already running
    if (!isRecording) {
      try {
        const activeWindow = await activeWin();
        captureWindowStatus = await captureWindow(activeWindow.title);
        repositionNotificationWindow(activeWindow);

        // If captureWindow() can't find the selected window, show an error and exit the process
        if (captureWindowStatus != "Window found") {
          const responseMessage = "Unable to capture this window, try another.";
          mainWindow.webContents.send(
            "add-window-name-to-app",
            responseMessage
          );
          notificationWindow.webContents.send(
            "add-window-name-to-app",
            responseMessage
          );
          return;
        }

        // If window is found, continue as expected
        const responseMessage = `${activeWindow.owner.name}: ${activeWindow.title}`;
        mainWindow.webContents.send("add-window-name-to-app", responseMessage);
        notificationWindow.webContents.send(
          "add-window-name-to-app",
          responseMessage
        );
      } catch (error) {
        console.error("Error capturing the active window:", error);
      }
      mainWindow.webContents.send("start-recording");
      notificationWindow.webContents.send("start-recording");

      mainWindow.webContents.send("start-recording-vedio");
      // notificationWindow.webContents.send("start-recording-vedio");
      isRecording = true;
    } else {
      // If we're already recording, the keyboard shortcut means we should stop
      mainWindow.webContents.send("stop-recording");
      notificationWindow.webContents.send("stop-recording");
      mainWindow.webContents.send("stop-recording-vedio");
      // notificationWindow.webContents.send("stop-recording-vedio");
      isRecording = false;
    }
  });

  ipcMain.handle('vedio-start-recording', async () => {
    console.log("vedio-start-recording")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const recordedChunks = [];
      const streamRecorder = new MediaRecorder(stream);

      streamRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        } else {
          // ...停止录制后处理数据
        }
      };

      streamRecorder.start(); // 开始录制

      // 这里你可以设置一个定时器或者其他机制来停止录制，例如：
      setTimeout(() => streamRecorder.stop(), 10000); // 10秒后停止录制

      return new Promise(resolve => {
        streamRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: 'video/mp4' }); // 创建 Blob 对象
          const buffer = Buffer.from(blob); // 转换为 Buffer 以使用 Node.js 文件系统 API
          // const outputPath = path.resolve(__dirname, 'recording.webm'); // 设置输出路径
          fs.writeFile(vedioFilePath, buffer, (err) => { // 将视频数据写入文件
            if (err) {
              console.error('Error saving video file:', err);
              resolve(false);
            } else {
              console.log('Video saved to:', outputPath);
              resolve(true);
            }
          });
        };
      });
    } catch (err) {
      console.error('Error accessing media devices:', err);
      return false;
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  // Unregister all shortcuts when the application is about to quit
  globalShortcut.unregisterAll();
});

ipcMain.on("update-analysis-content", (event, content) => {
  // Forward the content to the notification window
  if (notificationWindow) {
    notificationWindow.webContents.send("update-analysis-content", content);
  }
});
