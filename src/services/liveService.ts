import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export class LiveSession {
  private ai: GoogleGenAI;
  private session: any = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private onMessageCallback: (text: string, isModel: boolean) => void;
  private onStatusCallback: (status: string) => void;
  private onVolumeCallback?: (volume: number, frequencyData?: Uint8Array) => void;
  private audioQueue: Int16Array[] = [];
  private nextStartTime = 0;
  private activeSource: AudioBufferSourceNode | null = null;
  private isModelSpeaking = false;

  constructor(
    onMessage: (text: string, isModel: boolean) => void,
    onStatus: (status: string) => void,
    onVolume?: (volume: number, frequencyData?: Uint8Array) => void
  ) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    this.onMessageCallback = onMessage;
    this.onStatusCallback = onStatus;
    this.onVolumeCallback = onVolume;
  }

  async start() {
    try {
      this.onStatusCallback("Connecting...");
      
      this.session = await this.ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are MindMate AI, a compassionate and supportive AI therapy assistant. You are currently in a live voice call with the user. You MUST support both English and Hindi. Respond in the language the user uses, or use a mix (Hinglish) if appropriate. Keep your responses concise, warm, and natural for a spoken conversation. Listen actively and provide emotional support. If the user interrupts you, stop talking immediately and listen.",
        },
        callbacks: {
          onopen: () => {
            this.onStatusCallback("Connected");
            this.startAudioCapture();
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              const parts = message.serverContent.modelTurn.parts;
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const base64Data = part.inlineData.data;
                  const binaryString = atob(base64Data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const pcmData = new Int16Array(bytes.buffer);
                  this.audioQueue.push(pcmData);
                  this.playNextInQueue();
                }
                if (part.text) {
                  this.onMessageCallback(part.text, true);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              this.stopPlayback();
            }
          },
          onclose: () => {
            this.onStatusCallback("Disconnected");
            this.stop();
          },
          onerror: (error) => {
            console.error("Live API Error:", error);
            this.onStatusCallback("Error occurred");
            this.stop();
          },
        },
      });
    } catch (err) {
      console.error("Failed to start live session:", err);
      this.onStatusCallback("Connection failed");
    }
  }

  private async startAudioCapture() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;
      // Reduced buffer size for ultra-low latency (1024 samples ~ 64ms @ 16kHz)
      this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.session) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Track volume
        if (this.analyser && this.onVolumeCallback) {
          this.analyser.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          const normalizedVolume = rms * 2;
          
          this.onVolumeCallback(normalizedVolume, new Uint8Array(dataArray));

          // Simple silence detection
          if (!this.isModelSpeaking) {
            if (normalizedVolume < 0.01) {
              this.onStatusCallback("Listening...");
            } else {
              this.onStatusCallback("You are speaking...");
            }
          }
        }

        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        const base64Data = btoa(
          String.fromCharCode(...new Uint8Array(pcmData.buffer))
        );

        this.session.sendRealtimeInput({
          media: { data: base64Data, mimeType: "audio/pcm;rate=16000" },
        });
      };

      this.source.connect(this.analyser);
      this.analyser.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (err) {
      console.error("Audio capture error:", err);
    }
  }

  private playNextInQueue() {
    if (!this.audioContext || this.audioQueue.length === 0) return;

    // Schedule as many as possible
    while (this.audioQueue.length > 0) {
      const pcmData = this.audioQueue.shift()!;
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 0x7FFF;
      }

      const buffer = this.audioContext.createBuffer(1, floatData.length, 16000);
      buffer.getChannelData(0).set(floatData);

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      
      // Connect to analyser so we can see AI's volume too
      source.connect(this.analyser!);
      source.connect(this.audioContext.destination);

      const startTime = Math.max(this.audioContext.currentTime + 0.05, this.nextStartTime);
      source.start(startTime);
      
      this.nextStartTime = startTime + buffer.duration;
      this.activeSource = source;
      this.isModelSpeaking = true;
      this.onStatusCallback("MindMate is speaking...");

      source.onended = () => {
        if (this.activeSource === source) {
          this.isModelSpeaking = false;
          // If this was the last scheduled source and it ended, reset nextStartTime if needed
          if (this.audioContext && this.audioContext.currentTime > this.nextStartTime) {
            this.nextStartTime = this.audioContext.currentTime;
          }
        }
      };
    }
  }

  private stopPlayback() {
    this.audioQueue = [];
    this.nextStartTime = 0;
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch (e) {
        // Source might have already stopped
      }
      this.activeSource = null;
    }
    this.isModelSpeaking = false;
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.isModelSpeaking = false;
    this.audioQueue = [];
  }
}
