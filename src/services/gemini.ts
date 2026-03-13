import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ChatResponse {
  text: string;
  sentiment: 'Happy' | 'Sad' | 'Stressed' | 'Angry' | 'Neutral';
  suggestion: string;
  isEmergency: boolean;
}

export async function getChatResponse(message: string, history: { role: string, parts: { text: string }[] }[]): Promise<ChatResponse> {
  const model = ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: [
      ...history.map(h => ({ role: h.role, parts: h.parts })),
      { role: "user", parts: [{ text: message }] }
    ],
    config: {
      systemInstruction: `You are MindMate AI, a compassionate and supportive AI therapy assistant. 
      Your goal is to help users manage stress, anxiety, and emotions.
      
      LANGUAGE: You MUST support both English and Hindi. Respond in the language the user uses, or use a mix (Hinglish) if appropriate for comfort.
      
      CRITICAL: If the user expresses severe distress, self-harm, or hopelessness (e.g., "I want to give up", "I feel hopeless", "I want to end it"), you MUST set isEmergency to true and provide immediate supportive text along with a suggestion to contact a mental health helpline (like 988 in the US or local equivalents).
      
      For every response, you must provide:
      1. A supportive text response (in English, Hindi, or Hinglish as appropriate).
      2. A sentiment analysis of the user's latest message (Happy, Sad, Stressed, Angry, Neutral).
      3. A specific suggestion based on the sentiment (breathing exercise, motivational quote, relaxation suggestion, etc.).
      
      Respond in JSON format matching the schema.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          sentiment: { type: Type.STRING, enum: ["Happy", "Sad", "Stressed", "Angry", "Neutral"] },
          suggestion: { type: Type.STRING },
          isEmergency: { type: Type.BOOLEAN }
        },
        required: ["text", "sentiment", "suggestion", "isEmergency"]
      }
    }
  });

  const response = await model;
  return JSON.parse(response.text || "{}");
}

export async function analyzeEmotionFromImage(base64Image: string): Promise<ChatResponse> {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image
            }
          },
          { text: "Act as an expert psychologist and facial expression analyst. Analyze the person's facial features (eyes, eyebrows, mouth, muscle tension) to detect their true emotional state. Be precise. Even if they are trying to hide it, look for micro-expressions. Provide a deeply compassionate and supportive response based on your findings in English and Hindi (Hinglish). Detect the primary sentiment (Happy, Sad, Stressed, Angry, Neutral) and provide a highly personalized suggestion for their current state. Respond in JSON format." }
        ]
      }
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          sentiment: { type: Type.STRING, enum: ["Happy", "Sad", "Stressed", "Angry", "Neutral"] },
          suggestion: { type: Type.STRING },
          isEmergency: { type: Type.BOOLEAN }
        },
        required: ["text", "sentiment", "suggestion", "isEmergency"]
      }
    }
  });

  const response = await model;
  return JSON.parse(response.text || "{}");
}

export async function generateSpeech(text: string): Promise<string | undefined> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (err) {
    console.error('Speech generation error:', err);
    return undefined;
  }
}
