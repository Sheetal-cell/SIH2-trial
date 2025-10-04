// Import Firebase modules for v9 syntax
        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // Global variables for Firebase setup
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        // --- DOM Elements ---
        const toggleMicButton = document.getElementById('toggle-mic');
        const micStatusText = document.getElementById('mic-status-text');
        const micIcon = document.getElementById('mic-icon');
        const currentCaption = document.getElementById('current-caption');
        const loadingSpinner = document.getElementById('loading-spinner');
        const captionHistory = document.getElementById('caption-history');
        const statusLog = document.getElementById('status-log');
        const targetLanguageSelect = document.getElementById('target-language');

        // --- State Variables ---
        let recognition;
        let isListening = false;
        let isProcessing = false;
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=`;
        const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
 // Canvas will inject the API key

        // --- Utility Functions ---

        /**
         * Logs status messages to the UI.
         * @param {string} message 
         * @param {string} color 
         */
        function updateStatus(message, color = 'text-gray-300') {
            statusLog.innerHTML = `<p class="${color}">${new Date().toLocaleTimeString()} - ${message}</p>`;
        }

        /**
         * Handles exponential backoff for fetch retries.
         * @param {Function} fn - The function to retry (e.g., fetch call).
         * @param {number} maxRetries - Maximum number of retries.
         * @returns {Promise<Response>}
         */
        async function fetchWithRetry(fn, maxRetries = 3) {
            for (let i = 0; i < maxRetries; i++) {
                try {
                    return await fn();
                } catch (error) {
                    if (i === maxRetries - 1) throw error;
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    updateStatus(`API call failed. Retrying in ${Math.round(delay / 1000)}s...`, 'text-yellow-400');
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }


        // --- ML/API Pipeline (Simplification & Translation) ---

        /**
         * Simulates the ML backend pipeline: Simplification and Translation using Gemini.
         * @param {string} rawTranscript - The raw text from the Speech-to-Text module.
         * @param {string} targetLanguage - The language to translate to (e.g., 'Hindi').
         */
        async function processAndTranslate(rawTranscript, targetLanguage) {
            if (isProcessing) return;

            isProcessing = true;
            loadingSpinner.classList.remove('hidden');
            currentCaption.classList.add('hidden');
            updateStatus(`Processing: Simplification & Translation to ${targetLanguage}...`, 'text-blue-300');

            try {
                const systemPrompt = `You are a Real-time Captioning System's core ML engine. Your job is twofold: first, simplify the provided raw speech transcript into clear, concise, short sentences, removing filler words, repetitive phrases, and keeping only the core semantic meaning. The output should be easy-to-read, short text suitable for closed captioning. Second, translate this simplified English text into the target Indian language: ${targetLanguage}. You must only return a JSON object following the provided schema.`;

                const userQuery = `Raw transcript: "${rawTranscript}". Target language: ${targetLanguage}.`;

                const payload = {
                    contents: [{ parts: [{ text: userQuery }] }],
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                "simplified_english_text": { "type": "STRING", "description": "The simplified and concise English version of the raw transcript." },
                                "translated_text": { "type": "STRING", "description": "The translation of the simplified English text into the target Indian language." }
                            },
                            "propertyOrdering": ["simplified_english_text", "translated_text"]
                        }
                    }
                };

                const fetchFn = () => fetch(GEMINI_API_URL + API_KEY, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const response = await fetchWithRetry(fetchFn);
                const result = await response.json();

                const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!jsonText) {
                    throw new Error("API response was empty or malformed.");
                }

                const parsedData = JSON.parse(jsonText);
                const translatedCaption = parsedData.translated_text || 'Translation unavailable.';
                const simplifiedEnglish = parsedData.simplified_english_text || 'Simplification unavailable.';

                // Update UI
                currentCaption.textContent = translatedCaption;
                currentCaption.classList.remove('text-green-400', 'text-yellow-400');
                currentCaption.classList.add('text-blue-400'); // Final color for translated text

                // Add to history
                const historyItem = document.createElement('div');
                historyItem.className = 'py-2 px-3 bg-gray-700 rounded-lg border-l-4 border-blue-500';
                historyItem.innerHTML = `
                    <p class="font-bold text-white">${translatedCaption}</p>
                    <p class="text-xs text-gray-400 mt-1 italic">
                        Simplified English: ${simplifiedEnglish}
                    </p>
                `;
                captionHistory.prepend(historyItem);
                
                // Clear the default message if it exists
                if (captionHistory.querySelector('p.italic')) {
                    captionHistory.querySelector('p.italic').remove();
                }
                
                updateStatus(`Caption delivered in ${targetLanguage}.`, 'text-green-400');

            } catch (error) {
                console.error("Gemini API Error:", error);
                currentCaption.textContent = `Error: Could not process or translate. (${error.message.substring(0, 50)}...)`;
                currentCaption.classList.remove('text-green-400', 'text-blue-400');
                currentCaption.classList.add('text-red-500');
                updateStatus(`Error in ML pipeline: ${error.message}`, 'text-red-500');
            } finally {
                isProcessing = false;
                loadingSpinner.classList.add('hidden');
                currentCaption.classList.remove('hidden');
                // Auto-scroll history to the top for the newest item
                captionHistory.scrollTop = 0;
            }
        }

        // --- Speech Recognition (STT Module) ---

        function setupSpeechRecognition() {
            // Check for Web Speech API support
            if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                // IMPORTANT: Replaced alert() with console/status update as per instructions
                updateStatus('ERROR: Your browser does not support the Web Speech API. Please use Chrome or Edge.', 'text-red-500');
                toggleMicButton.disabled = true;
                return;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            recognition = new SpeechRecognition();

            // Use the standard language for transcription (English/Hindi auto-detection)
            // Setting the lang property for better recognition
            recognition.lang = 'en-US'; 
            recognition.continuous = true; // Keep listening after a pause
            recognition.interimResults = true; // Show results as they are being spoken

            recognition.onstart = () => {
                isListening = true;
                toggleMicButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                toggleMicButton.classList.add('bg-red-600', 'hover:bg-red-700', 'blinking-mic');
                micStatusText.textContent = 'Listening... Speak Now';
                updateStatus('Microphone is ON. Listening for speech.', 'text-green-400');
            };

            recognition.onend = () => {
                isListening = false;
                toggleMicButton.classList.remove('bg-red-600', 'hover:bg-red-700', 'blinking-mic');
                toggleMicButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
                micStatusText.textContent = 'Start Captioning';
                updateStatus('Microphone is OFF. Click to restart.', 'text-yellow-400');
                
                // Automatically restart if it stops unexpectedly while the user hasn't explicitly stopped it
                if (isListening) {
                     recognition.start();
                }
            };
            
            // This event fires as the user speaks (interimResults: true)
            recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                // Show the raw, interim transcript immediately
                currentCaption.textContent = interimTranscript;
                currentCaption.classList.remove('text-blue-400');
                currentCaption.classList.add('text-green-400'); // Green for raw/interim STT

                // Once a final result is captured (usually after a pause/sentence end)
                if (finalTranscript.length > 0) {
                    updateStatus(`Raw Transcript Captured: "${finalTranscript}"`, 'text-white');
                    // Send final text to the ML pipeline
                    processAndTranslate(finalTranscript.trim(), targetLanguageSelect.value);
                }
            };

            recognition.onerror = (event) => {
                console.error('Speech Recognition Error:', event.error);
                updateStatus(`ERROR: Speech Recognition failed. (${event.error})`, 'text-red-500');
                recognition.stop();
            };
        }

        // --- Event Listeners and Initialization ---

        toggleMicButton.addEventListener('click', () => {
            if (!recognition) {
                setupSpeechRecognition();
            }
            if (isListening) {
                recognition.stop();
            } else {
                try {
                    recognition.start();
                } catch (e) {
                    console.error("Recognition start error:", e);
                    // This often happens if start() is called when already started. onstart handler usually prevents this.
                }
            }
        });

        // Initialize Firebase (optional, for future features like saving transcripts)
        function initializeFirebase() {
            if (firebaseConfig) {
                // Use imported functions (initializeApp, getAuth, getFirestore)
                const app = initializeApp(firebaseConfig);
                const auth = getAuth(app);
                const db = getFirestore(app);
                
                // Sign in anonymously or with custom token
                if (initialAuthToken) {
                    signInWithCustomToken(auth, initialAuthToken)
                        .then((userCredential) => {
                            console.log("Firebase signed in with custom token.", userCredential.user.uid);
                        })
                        .catch((error) => {
                            console.error("Firebase Auth Error (Custom Token):", error);
                        });
                } else {
                    signInAnonymously(auth)
                        .then((userCredential) => {
                            console.log("Firebase signed in anonymously.", userCredential.user.uid);
                        })
                        .catch((error) => {
                            console.error("Firebase Auth Error (Anonymous):", error);
                        });
                }
            } else {
                console.warn("Firebase config not available. Database features are disabled.");
            }
        }

        // Setup on window load
        window.onload = () => {
            initializeFirebase();
            setupSpeechRecognition();
            targetLanguageSelect.addEventListener('change', () => {
                updateStatus(`Target language changed to ${targetLanguageSelect.value}.`, 'text-blue-300');
            });
        };