import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageCircle, 
  Heart, 
  Smile, 
  Frown, 
  Meh, 
  Send, 
  AlertCircle, 
  BarChart2, 
  Wind, 
  Quote, 
  Sparkles,
  Camera,
  Video,
  VideoOff,
  CameraOff,
  RefreshCcw,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  StickyNote,
  Volume2,
  VolumeX,
  Mic,
  Phone,
  PhoneOff,
  X,
  AlertTriangle,
  ShieldAlert,
  UserPlus,
  Trash2,
  LifeBuoy,
  MapPin,
  MessageSquare
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths 
} from 'date-fns';
import { getChatResponse, ChatResponse, analyzeEmotionFromImage, generateSpeech } from './services/gemini';
import { LiveSession } from './services/liveService';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  sentiment?: string;
  suggestion?: string;
  isEmergency?: boolean;
}

interface MoodEntry {
  id: number;
  date: string;
  mood: string;
  value: number;
  note?: string;
}

const moodToValue = (mood: string) => {
  switch (mood) {
    case 'Happy': return 5;
    case 'Neutral': return 3;
    case 'Stressed': return 2;
    case 'Angry': return 1;
    case 'Sad': return 0;
    default: return 3;
  }
};

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
  notes?: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hello! I'm MindMate AI, your emotional support companion. How are you feeling today? (नमस्ते! मैं माइंडमेट एआई हूँ, आपका भावनात्मक साथी। आज आप कैसा महसूस कर रहे हैं?)",
      sender: 'ai'
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [moodHistory, setMoodHistory] = useState<MoodEntry[]>([]);
  const [currentMood, setCurrentMood] = useState<string | null>(null);
  const [moodNote, setMoodNote] = useState('');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [viewMode, setViewMode] = useState<'chart' | 'calendar'>('chart');
  const [timeRange, setTimeRange] = useState<'recent' | 'weekly' | 'monthly'>('recent');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isAnalyzingCamera, setIsAnalyzingCamera] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [isCrisisDetected, setIsCrisisDetected] = useState(false);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>(() => {
    const saved = localStorage.getItem('emergency_contacts');
    return saved ? JSON.parse(saved) : [];
  });
  const [newContact, setNewContact] = useState({ name: '', phone: '', relation: '', notes: '' });
  const [callStatus, setCallStatus] = useState("");
  const [callTranscript, setCallTranscript] = useState<{ text: string, isModel: boolean }[]>([]);
  const [callVolume, setCallVolume] = useState(0);
  const [frequencyData, setFrequencyData] = useState<Uint8Array | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [lastDetectedSentiment, setLastDetectedSentiment] = useState<string | null>(null);
  const [sentimentHistory, setSentimentHistory] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMoodHistory = useMemo(() => {
    if (timeRange === 'recent') return moodHistory.slice(0, 10);
    
    const now = new Date();
    const days = timeRange === 'weekly' ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - days);
    
    return moodHistory.filter(m => new Date(m.date) >= cutoff);
  }, [moodHistory, timeRange]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchMoods();
  }, []);

  const fetchMoods = async () => {
    try {
      const res = await fetch('/api/moods');
      const data = await res.json();
      const formattedData = data.map((m: any) => ({
        id: m.id,
        date: m.date,
        mood: m.mood,
        value: moodToValue(m.mood),
        note: m.note
      }));
      setMoodHistory(formattedData);
    } catch (err) {
      console.error('Failed to fetch moods', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'user'
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Crisis detection keywords
    const crisisKeywords = ['suicide', 'kill myself', 'end my life', 'want to die', 'better off dead', 'self harm', 'hurt myself'];
    const lowerInput = input.toLowerCase();
    if (crisisKeywords.some(keyword => lowerInput.includes(keyword))) {
      setIsCrisisDetected(true);
    }

    try {
      const history = messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const aiResponse = await getChatResponse(input, history);
      
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: aiResponse.text,
        sender: 'ai',
        sentiment: aiResponse.sentiment,
        suggestion: aiResponse.suggestion,
        isEmergency: aiResponse.isEmergency
      };

      setMessages(prev => [...prev, aiMessage]);

      // Auto-track mood from conversation
      if (aiResponse.sentiment) {
        trackMood(aiResponse.sentiment, `Detected from conversation: "${input.slice(0, 30)}${input.length > 30 ? '...' : ''}"`);
      }

      // Voice logic: Strictly respect the toggle
      if (isVoiceEnabled) {
        speakText(aiResponse.text);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment.",
        sender: 'ai'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const trackMood = async (mood: string, note?: string) => {
    setCurrentMood(mood);
    const date = new Date().toISOString();
    try {
      await fetch('/api/moods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood, date, note })
      });
      fetchMoods();
      setMoodNote('');
      setShowNoteInput(false);
    } catch (err) {
      console.error('Failed to track mood', err);
    }
  };

  const deleteMood = async (id: number) => {
    try {
      await fetch(`/api/moods/${id}`, { method: 'DELETE' });
      fetchMoods();
    } catch (err) {
      console.error('Failed to delete mood', err);
    }
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const runLiveAnalysis = async () => {
      if (isLiveMode && isCameraActive && !isAnalyzingCamera) {
        await analyzeCameraFrame(true);
        timeoutId = setTimeout(runLiveAnalysis, 3000); // Increased frequency to 3 seconds
      }
    };

    if (isLiveMode) {
      runLiveAnalysis();
    }

    return () => clearTimeout(timeoutId);
  }, [isLiveMode, isCameraActive]);

  useEffect(() => {
    if (isCameraActive && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [isCameraActive, cameraStream]);

  const speakText = async (text: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const base64Audio = await generateSpeech(text);
      if (base64Audio) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const pcmData = new Int16Array(bytes.buffer);
        const floatData = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          floatData[i] = pcmData[i] / 32768;
        }

        const buffer = audioContext.createBuffer(1, floatData.length, 24000);
        buffer.getChannelData(0).set(floatData);

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        
        source.onended = () => {
          setIsSpeaking(false);
          audioContext.close();
        };
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (err) {
      console.error('Speech error:', err);
      setIsSpeaking(false);
    }
  };

  const toggleListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const addEmergencyContact = () => {
    if (newContact.name && newContact.phone) {
      const contact: EmergencyContact = {
        id: Date.now().toString(),
        ...newContact
      };
      setEmergencyContacts(prev => [...prev, contact]);
      setNewContact({ name: '', phone: '', relation: '', notes: '' });
    }
  };

  const removeEmergencyContact = (id: string) => {
    setEmergencyContacts(prev => prev.filter(c => c.id !== id));
  };

  const sendLocation = (phone: string) => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords;
        const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const message = encodeURIComponent(`EMERGENCY: I need help. My live location is: ${mapsUrl}`);
        window.location.href = `sms:${phone}?body=${message}`;
      }, (error) => {
        console.error("Error getting location:", error);
        alert("Could not get your location. Please check your GPS settings.");
      });
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCallActive) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isCallActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startCall = async () => {
    setIsCallActive(true);
    setCallTranscript([]);
    setCallVolume(0);
    setFrequencyData(null);
    const session = new LiveSession(
      (text, isModel) => {
        setCallTranscript(prev => [...prev, { text, isModel }].slice(-5));
      },
      (status) => setCallStatus(status),
      (volume, freq) => {
        setCallVolume(volume);
        if (freq) setFrequencyData(freq);
      }
    );
    setLiveSession(session);
    await session.start();
  };

  const endCall = () => {
    if (liveSession) {
      liveSession.stop();
      setLiveSession(null);
    }
    setIsCallActive(false);
    setCallStatus("");
    setCallVolume(0);
    setCallDuration(0);
  };

  const toggleCamera = async () => {
    if (isCameraActive) {
      cameraStream?.getTracks().forEach(track => track.stop());
      setCameraStream(null);
      setIsCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setCameraStream(stream);
        setIsCameraActive(true);
      } catch (err) {
        console.error('Failed to access camera', err);
        alert('Could not access camera. Please check permissions.');
      }
    }
  };

  const analyzeCameraFrame = async (isAuto = false) => {
    if (!videoRef.current || !canvasRef.current || isAnalyzingCamera) return;

    setIsAnalyzingCamera(true);
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    // Enhanced resolution for better detection while maintaining speed
    const maxDim = 640;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > height) {
      if (width > maxDim) {
        height = (height * maxDim) / width;
        width = maxDim;
      }
    } else {
      if (height > maxDim) {
        width = (width * maxDim) / height;
        height = maxDim;
      }
    }
    
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0, width, height);

    const base64Image = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

    try {
      const aiResponse = await analyzeEmotionFromImage(base64Image);
      
      // Smoothing logic: Add to history and find majority
      const newHistory = [...sentimentHistory, aiResponse.sentiment].slice(-3);
      setSentimentHistory(newHistory);

      // Simple majority vote for smoother transitions
      const counts: Record<string, number> = {};
      newHistory.forEach(s => counts[s] = (counts[s] || 0) + 1);
      const smoothedSentiment = Object.entries(counts).reduce((a, b) => a[1] > b[1] ? a : b)[0];

      // Only add to chat if it's manual, an emergency, or a significant sentiment change in the smoothed value
      const shouldAddMessage = !isAuto || aiResponse.isEmergency || (smoothedSentiment !== lastDetectedSentiment && newHistory.length >= 2);

      if (shouldAddMessage) {
        const aiMessage: Message = {
          id: Date.now().toString(),
          text: isAuto ? `[Live Update] ${aiResponse.text}` : `[Visual Analysis] ${aiResponse.text}`,
          sender: 'ai',
          sentiment: aiResponse.sentiment,
          suggestion: aiResponse.suggestion,
          isEmergency: aiResponse.isEmergency
        };
        setMessages(prev => [...prev, aiMessage]);
      }

      if (smoothedSentiment) {
        setLastDetectedSentiment(smoothedSentiment);
        trackMood(smoothedSentiment);
        
        // Voice support for visual analysis: Speak if sad or voice enabled
        if (isVoiceEnabled || smoothedSentiment === 'Sad') {
          speakText(aiResponse.text);
        }
      }
    } catch (err) {
      console.error('Camera analysis error:', err);
    } finally {
      setIsAnalyzingCamera(false);
    }
  };

  const getSentimentColor = (sentiment: string | null) => {
    if (!sentiment) return 'border-transparent';
    const s = sentiment.toLowerCase();
    if (s.includes('happy') || s.includes('joy')) return 'border-green-500';
    if (s.includes('sad') || s.includes('blue')) return 'border-blue-500';
    if (s.includes('angry') || s.includes('mad')) return 'border-red-500';
    if (s.includes('surprised') || s.includes('shocked')) return 'border-yellow-500';
    if (s.includes('fear') || s.includes('scared')) return 'border-purple-500';
    if (s.includes('disgust')) return 'border-orange-500';
    return 'border-gray-400';
  };

  const renderCalendar = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const calendarDays = eachDayOfInterval({
      start: startDate,
      end: endDate,
    });

    const rows = [];
    let days = [];

    calendarDays.forEach((day, i) => {
      const dayMoods = moodHistory.filter(m => isSameDay(new Date(m.date), day));
      const hasMood = dayMoods.length > 0;
      const primaryMood = dayMoods[0]?.mood;

      days.push(
        <div
          key={day.toString()}
          className={`h-14 border border-blue-50/50 flex flex-col items-center justify-center relative ${
            !isSameMonth(day, monthStart) ? 'bg-gray-50/50 text-gray-300' : 'text-gray-700'
          }`}
        >
          <span className="text-[10px] absolute top-1 left-1">{format(day, 'd')}</span>
          {hasMood && (
            <div className={`w-2 h-2 rounded-full ${
              primaryMood === 'Happy' ? 'bg-green-400' : 
              primaryMood === 'Sad' ? 'bg-red-400' : 'bg-blue-400'
            }`} />
          )}
          {dayMoods.some(m => m.note) && (
            <StickyNote className="w-2 h-2 text-blue-300 absolute top-1 right-1" />
          )}
        </div>
      );

      if ((i + 1) % 7 === 0) {
        rows.push(
          <div key={i} className="grid grid-cols-7">
            {days}
          </div>
        );
        days = [];
      }
    });

    return (
      <div className="mt-4 border border-blue-100 rounded-2xl overflow-hidden bg-white">
        <div className="flex items-center justify-between p-3 bg-blue-50/50 border-b border-blue-100">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1 hover:bg-blue-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-blue-600" />
          </button>
          <span className="text-xs font-bold text-blue-900">{format(currentMonth, 'MMMM yyyy')}</span>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1 hover:bg-blue-100 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4 text-blue-600" />
          </button>
        </div>
        <div className="grid grid-cols-7 bg-blue-50/30 border-b border-blue-100">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
            <div key={d} className="py-1 text-center text-[10px] font-bold text-blue-400">{d}</div>
          ))}
        </div>
        {rows}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F0F7F9] text-[#2C3E50] font-sans">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-blue-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEmergencyModalOpen(true)}
            className="p-2 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-all flex items-center gap-2"
            title="Emergency SOS"
          >
            <ShieldAlert className="w-5 h-5" />
            <span className="text-xs font-bold hidden sm:inline">SOS</span>
          </button>
          <button
            onClick={startCall}
            className="p-2 bg-green-100 text-green-600 rounded-xl hover:bg-green-200 transition-all flex items-center gap-2"
            title="Start Voice Call"
          >
            <Phone className="w-5 h-5" />
            <span className="text-xs font-bold hidden sm:inline">Talk to MindMate</span>
          </button>
          <button
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            className={`p-2 rounded-xl transition-all ${isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}
            title={isVoiceEnabled ? "Voice Enabled" : "Voice Disabled"}
          >
            {isVoiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          <div className="bg-blue-500 p-2 rounded-xl">
            <Heart className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-blue-900">MindMate AI</h1>
            <p className="text-xs text-blue-500 font-medium">Your Emotional Support Companion</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Mood Tracker & Info */}
        <div className="lg:col-span-1 space-y-8">
          {/* Hero Section */}
          <section className="bg-gradient-to-br from-blue-500 to-teal-400 rounded-3xl p-8 text-white shadow-xl shadow-blue-200/50">
            <h2 className="text-2xl font-bold mb-3">Breathe In, Breathe Out</h2>
            <p className="text-blue-50 opacity-90 text-sm leading-relaxed">
              MindMate is here to listen. Talk about your feelings, manage stress, and find your inner peace through supportive conversation.
            </p>
            <div className="mt-6 flex gap-3">
              <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                <Wind className="w-5 h-5" />
              </div>
            </div>
          </section>

          {/* Mood Journey Section */}
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-blue-50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <BarChart2 className="text-blue-500 w-5 h-5" />
                Mood Journey
              </h3>
              <div className="flex items-center gap-2">
                {viewMode === 'chart' && (
                  <select 
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value as any)}
                    className="text-[10px] font-bold bg-blue-50 border-none rounded-lg px-2 py-1 text-blue-600 focus:ring-0 cursor-pointer"
                  >
                    <option value="recent">Recent</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                )}
                <div className="flex bg-blue-50 p-1 rounded-xl">
                  <button 
                    onClick={() => setViewMode('chart')}
                    className={`p-1.5 rounded-lg transition-all ${viewMode === 'chart' ? 'bg-white shadow-sm text-blue-600' : 'text-blue-400'}`}
                  >
                    <BarChart2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setViewMode('calendar')}
                    className={`p-1.5 rounded-lg transition-all ${viewMode === 'calendar' ? 'bg-white shadow-sm text-blue-600' : 'text-blue-400'}`}
                  >
                    <CalendarIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {viewMode === 'chart' ? (
              <div className="h-48 w-full">
                {filteredMoodHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...filteredMoodHistory].reverse().map(m => ({ 
                      ...m, 
                      date: format(new Date(m.date), timeRange === 'recent' ? 'HH:mm' : 'MMM dd') 
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f7ff" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 8, fill: '#94a3b8' }}
                        dy={10}
                      />
                      <YAxis hide domain={[0, 5]} />
                      <Tooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-white p-3 rounded-2xl shadow-xl border border-blue-50 z-50">
                                <p className="text-[10px] font-bold text-gray-400 mb-1">{format(new Date(data.date), 'MMM dd, HH:mm')}</p>
                                <p className="text-xs font-bold text-blue-600">{data.mood}</p>
                                {data.note && (
                                  <p className="text-[10px] text-gray-500 mt-1 italic max-w-[150px] break-words">"{data.note}"</p>
                                )}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#3b82f6" 
                        strokeWidth={3}
                        dot={{ r: 3, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm italic">
                    No data for this period
                  </div>
                )}
              </div>
            ) : (
              renderCalendar()
            )}

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500">How are you right now?</p>
                <button 
                  onClick={() => setShowNoteInput(!showNoteInput)}
                  className={`text-[10px] font-bold flex items-center gap-1 transition-colors ${showNoteInput ? 'text-blue-600' : 'text-gray-400 hover:text-blue-500'}`}
                >
                  <Plus className="w-3 h-3" />
                  {showNoteInput ? 'Cancel Note' : 'Add Note'}
                </button>
              </div>
              
              {showNoteInput && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4"
                >
                  <textarea
                    value={moodNote}
                    onChange={(e) => setMoodNote(e.target.value)}
                    placeholder="Add some context to your mood..."
                    className="w-full bg-blue-50/50 border border-blue-100 rounded-2xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none h-20"
                  />
                </motion.div>
              )}

              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { label: 'Happy', icon: Smile, color: 'text-green-500', bg: 'bg-green-50' },
                  { label: 'Neutral', icon: Meh, color: 'text-blue-500', bg: 'bg-blue-50' },
                  { label: 'Stressed', icon: Wind, color: 'text-purple-500', bg: 'bg-purple-50' },
                  { label: 'Angry', icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-50' },
                  { label: 'Sad', icon: Frown, color: 'text-red-500', bg: 'bg-red-50' }
                ].map((m) => (
                  <button
                    key={m.label}
                    onClick={() => trackMood(m.label, moodNote)}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all hover:scale-105 ${currentMood === m.label ? m.bg + ' ring-1 ring-' + m.color.split('-')[1] + '-200' : 'bg-gray-50'}`}
                  >
                    <m.icon className={`w-5 h-5 ${m.color}`} />
                    <span className="text-[9px] font-bold text-gray-600">{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Recent Entries List */}
              {moodHistory.length > 0 && (
                <div className="mt-6 pt-6 border-t border-blue-50">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Recent Entries</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                    {moodHistory.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between p-2 bg-blue-50/30 rounded-xl group hover:bg-blue-50 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            entry.mood === 'Happy' ? 'bg-green-400' : 
                            entry.mood === 'Sad' ? 'bg-red-400' : 
                            entry.mood === 'Stressed' ? 'bg-purple-400' :
                            entry.mood === 'Angry' ? 'bg-orange-400' : 'bg-blue-400'
                          }`} />
                          <div>
                            <p className="text-[10px] font-bold text-blue-900">{entry.mood}</p>
                            <p className="text-[8px] text-gray-400">{format(new Date(entry.date), 'MMM dd, HH:mm')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.note && (
                            <div className="group/note relative">
                              <StickyNote className="w-3 h-3 text-blue-300" />
                              <div className="absolute bottom-full right-0 mb-2 w-48 p-2 bg-white rounded-lg shadow-xl border border-blue-50 text-[9px] text-gray-600 hidden group-hover/note:block z-50">
                                {entry.note}
                              </div>
                            </div>
                          )}
                          <button 
                            onClick={() => deleteMood(entry.id)}
                            className="p-1 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Visual Emotion Detection */}
          <section className="bg-white rounded-3xl p-6 shadow-sm border border-blue-50 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Camera className="text-blue-500 w-5 h-5" />
                Visual Analysis
              </h3>
              {isCameraActive && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Live Mode</span>
                  <button
                    onClick={() => setIsLiveMode(!isLiveMode)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${isLiveMode ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isLiveMode ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              )}
            </div>
            <div className={`relative aspect-video bg-gray-100 rounded-2xl overflow-hidden mb-4 group border-4 transition-all duration-500 ${getSentimentColor(lastDetectedSentiment)}`}>
              {isCameraActive ? (
                <>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="w-full h-full object-cover"
                  />
                  {isAnalyzingCamera && (
                    <motion.div 
                      initial={{ top: 0 }}
                      animate={{ top: '100%' }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-0.5 bg-blue-400/50 shadow-[0_0_15px_rgba(96,165,250,0.5)] z-10"
                    />
                  )}
                  {isLiveMode && (
                    <div className="absolute top-3 left-3 flex items-center gap-2 px-2 py-1 bg-black/40 backdrop-blur-md rounded-lg z-20">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      <span className="text-[10px] font-bold text-white uppercase tracking-wider">Live</span>
                    </div>
                  )}
                  {lastDetectedSentiment && (
                    <div className="absolute bottom-3 left-3 px-3 py-1 bg-white/90 backdrop-blur-md rounded-full shadow-sm border border-blue-50 flex items-center gap-2 z-20">
                      <div className={`w-2 h-2 rounded-full ${getSentimentColor(lastDetectedSentiment).replace('border-', 'bg-')}`} />
                      <p className="text-[10px] font-bold text-blue-900">
                        Detected: <span className="text-blue-500 uppercase">{lastDetectedSentiment}</span>
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <VideoOff className="w-12 h-12 mb-2 opacity-20" />
                  <p className="text-xs">Camera is off</p>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
              
              <button
                onClick={toggleCamera}
                className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur-md rounded-xl shadow-sm hover:bg-white transition-colors"
              >
                {isCameraActive ? <Video className="w-4 h-4 text-red-500" /> : <VideoOff className="w-4 h-4 text-gray-500" />}
              </button>
            </div>
            
            <button
              onClick={() => analyzeCameraFrame(false)}
              disabled={!isCameraActive || isAnalyzingCamera || isLiveMode}
              className="w-full py-3 bg-blue-500 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-blue-200"
            >
              {isAnalyzingCamera ? (
                <>
                  <RefreshCcw className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {isLiveMode ? 'Live Analysis Active' : 'Analyze My Emotion'}
                </>
              )}
            </button>
            <p className="text-[10px] text-center text-gray-400 mt-3">
              {isLiveMode 
                ? 'MindMate is monitoring your expressions to provide real-time support.' 
                : 'We use your camera to detect facial expressions for better support.'}
            </p>
          </section>
        </div>

        {/* Right Column: Chatbot */}
        <div className="lg:col-span-2 flex flex-col h-[calc(100vh-120px)]">
          <div className="flex-1 bg-white rounded-3xl shadow-sm border border-blue-50 overflow-hidden flex flex-col">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {isVoiceEnabled && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-bold uppercase tracking-wider w-fit mb-4">
                  <Volume2 className="w-3 h-3" />
                  Voice Mode Active
                </div>
              )}
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] space-y-2`}>
                      <div className={`p-4 rounded-2xl ${
                        m.sender === 'user' 
                          ? 'bg-blue-500 text-white rounded-tr-none' 
                          : 'bg-blue-50 text-blue-900 rounded-tl-none'
                      }`}>
                        <div className="flex justify-between items-start gap-4">
                          <p className="text-sm leading-relaxed">{m.text}</p>
                          {m.sender === 'ai' && (
                            <button 
                              onClick={() => speakText(m.text)}
                              className="p-1 hover:bg-blue-100 rounded-lg transition-colors text-blue-400"
                              title="Speak message"
                            >
                              <Volume2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {m.sender === 'ai' && (m.sentiment || m.suggestion || m.isEmergency) && (
                        <div className="space-y-2">
                          {m.isEmergency && (
                            <div className="bg-red-50 border border-red-100 p-3 rounded-xl flex items-start gap-2 text-red-700">
                              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <p className="text-xs font-medium">
                                It sounds like you're going through a very tough time. Please reach out to a professional or a helpline like 988 (US) or your local emergency services. You're not alone.
                              </p>
                            </div>
                          )}
                          {m.sentiment && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 rounded-full text-[10px] font-bold uppercase tracking-wider text-gray-500">
                              <Sparkles className="w-3 h-3" />
                              Detected: {m.sentiment}
                            </div>
                          )}
                          {m.suggestion && (
                            <div className="bg-teal-50 border border-teal-100 p-3 rounded-xl flex items-start gap-2 text-teal-800">
                              <Quote className="w-4 h-4 mt-0.5 flex-shrink-0 text-teal-500" />
                              <p className="text-xs italic">{m.suggestion}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-blue-50 p-4 rounded-2xl rounded-tl-none flex gap-1">
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 bg-gray-50 border-t border-blue-50">
              <div className="relative flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="How are you feeling right now?"
                    className="w-full bg-white border border-blue-100 rounded-2xl py-4 pl-6 pr-24 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm resize-none max-h-[96px] overflow-y-auto"
                  />
                  <div className="absolute right-3 bottom-3 flex items-center gap-1">
                    <button
                      onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                      className={`p-2 rounded-xl transition-all ${
                        isVoiceEnabled ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-blue-500'
                      }`}
                      title={isVoiceEnabled ? "Text-to-Speech Enabled" : "Text-to-Speech Disabled"}
                    >
                      {isVoiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={toggleListening}
                      className={`p-2 rounded-xl transition-all ${
                        isListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-gray-400 hover:text-blue-500'
                      }`}
                      title={isListening ? "Listening..." : "Voice Input"}
                    >
                      <Mic className={`w-5 h-5 ${isListening ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-4 bg-blue-500 text-white rounded-2xl hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-blue-500 transition-colors flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[10px] text-center text-gray-400 mt-3">
                MindMate AI is an assistant, not a replacement for professional therapy.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Crisis Detection Modal */}
      <AnimatePresence>
        {isCrisisDetected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-red-900/95 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-center">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <LifeBuoy className="w-10 h-10 text-red-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">You are not alone.</h2>
              <p className="text-gray-600 mb-8">
                It sounds like you're going through a very difficult time. Please reach out for professional help immediately. There are people who want to support you.
              </p>
              
              <div className="space-y-4 mb-8">
                <a 
                  href="tel:988" 
                  className="block w-full p-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all"
                >
                  Call 988 (Suicide & Crisis Lifeline)
                </a>
                <button 
                  onClick={() => {
                    setIsCrisisDetected(false);
                    setIsEmergencyModalOpen(true);
                  }}
                  className="block w-full p-4 bg-gray-100 text-gray-900 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                >
                  Contact My Emergency List
                </button>
              </div>
              
              <button 
                onClick={() => setIsCrisisDetected(false)}
                className="text-gray-400 text-sm hover:underline"
              >
                I'm okay now, close this.
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emergency SOS Modal */}
      <AnimatePresence>
        {isEmergencyModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 bg-red-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <ShieldAlert className="w-6 h-6" />
                  <h2 className="text-xl font-bold">Emergency Support</h2>
                </div>
                <button onClick={() => setIsEmergencyModalOpen(false)} className="p-2 hover:bg-white/10 rounded-lg">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 max-h-[70vh] overflow-y-auto">
                {/* Immediate Actions */}
                <div className="grid grid-cols-2 gap-4 mb-8">
                  <a href="tel:911" className="flex flex-col items-center justify-center p-6 bg-red-50 rounded-2xl border-2 border-red-100 hover:border-red-500 transition-all group">
                    <AlertTriangle className="w-8 h-8 text-red-600 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-red-900">Police / 911</span>
                  </a>
                  <a href="tel:911" className="flex flex-col items-center justify-center p-6 bg-blue-50 rounded-2xl border-2 border-blue-100 hover:border-blue-500 transition-all group">
                    <LifeBuoy className="w-8 h-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-blue-900">Medical Help</span>
                  </a>
                </div>

                {/* Emergency Contacts */}
                <div className="mb-8">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">My Emergency Contacts</h3>
                  {emergencyContacts.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                      <p className="text-gray-400 text-sm">No emergency contacts added yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {emergencyContacts.map(contact => (
                        <div key={contact.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl group">
                          <div>
                            <p className="font-bold text-gray-900">{contact.name}</p>
                            <p className="text-xs text-gray-500">{contact.relation} • {contact.phone}</p>
                            {contact.notes && (
                              <p className="text-xs text-gray-400 mt-1 italic">"{contact.notes}"</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => sendLocation(contact.phone)}
                              className="p-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
                              title="Send Live Location via SMS"
                            >
                              <MapPin className="w-4 h-4" />
                            </button>
                            <a 
                              href={`tel:${contact.phone}`}
                              className="p-2 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-colors"
                              title="Call Contact"
                            >
                              <Phone className="w-4 h-4" />
                            </a>
                            <button 
                              onClick={() => removeEmergencyContact(contact.id)}
                              className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Contact Form */}
                <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                  <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <UserPlus className="w-4 h-4" /> Add New Contact
                  </h3>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Name"
                      value={newContact.name}
                      onChange={e => setNewContact({...newContact, name: e.target.value})}
                      className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Phone"
                        value={newContact.phone}
                        onChange={e => setNewContact({...newContact, phone: e.target.value})}
                        className="p-3 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Relation (e.g. Mom)"
                        value={newContact.relation}
                        onChange={e => setNewContact({...newContact, relation: e.target.value})}
                        className="p-3 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
                      />
                    </div>
                    <textarea
                      placeholder="Notes or instructions (e.g. 'Has spare key', 'Call first')"
                      value={newContact.notes}
                      onChange={e => setNewContact({...newContact, notes: e.target.value})}
                      className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none resize-none h-20"
                    />
                    <button
                      onClick={addEmergencyContact}
                      disabled={!newContact.name || !newContact.phone}
                      className="w-full p-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all disabled:opacity-50"
                    >
                      Save Contact
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Call Overlay */}
      <AnimatePresence>
        {isCallActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-blue-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-white"
          >
            <div className="relative mb-12">
              <motion.div
                animate={{ 
                  scale: [1, 1.2 + callVolume, 1.1 + callVolume * 0.5, 1.3 + callVolume, 1], 
                  opacity: [0.3, 0.6, 0.4, 0.7, 0.3],
                  rotate: [0, 5, -5, 5, 0]
                }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                className="absolute inset-0 bg-blue-400 rounded-full blur-3xl"
              />
              <motion.div
                animate={{ 
                  scale: [1, 1.1 + callVolume * 0.3, 1],
                  opacity: [0.2, 0.4, 0.2]
                }}
                transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                className="absolute -inset-8 bg-teal-300 rounded-full blur-2xl"
              />
              
              {/* Visualizer bars */}
              <div className="absolute -inset-16 flex items-center justify-center gap-1.5 opacity-40">
                {[...Array(16)].map((_, i) => {
                  const freqValue = frequencyData ? frequencyData[i * 8] / 255 : 0;
                  return (
                    <motion.div
                      key={i}
                      animate={{ 
                        height: [20, 20 + (freqValue * 150), 20],
                      }}
                      transition={{ 
                        duration: 0.1,
                        ease: "linear"
                      }}
                      className="w-1.5 bg-blue-300 rounded-full shadow-[0_0_10px_rgba(147,197,253,0.5)]"
                    />
                  );
                })}
              </div>

              <div className="relative bg-white/10 p-12 rounded-full border border-white/20 backdrop-blur-sm shadow-2xl">
                <motion.div
                  animate={{
                    scale: 1 + (callVolume * 0.5),
                  }}
                  transition={{ duration: 0.1 }}
                >
                  <Heart className={`w-24 h-24 transition-colors duration-200 ${callVolume > 0.1 ? 'text-white' : 'text-blue-400'}`} />
                </motion.div>
              </div>
            </div>

            <h2 className="text-3xl font-bold mb-2">MindMate AI</h2>
            <div className="flex flex-col items-center gap-2 mb-8">
              <p className="text-blue-300 font-medium tracking-widest uppercase text-[10px] px-3 py-1 bg-white/5 rounded-full border border-white/10">
                {callStatus || "Connecting..."}
              </p>
              <p className="text-blue-100/60 font-mono text-sm tracking-widest">
                {formatDuration(callDuration)}
              </p>
            </div>

            {/* Live Transcript */}
            <div className="w-full max-w-md h-32 overflow-hidden relative mb-12">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-blue-900/95 z-10" />
              <div className="space-y-4 px-4">
                <AnimatePresence mode="popLayout">
                  {callTranscript.map((t, i) => (
                    <motion.div
                      key={i + t.text}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className={`text-center ${t.isModel ? 'text-blue-100 font-medium' : 'text-blue-300 italic text-sm'}`}
                    >
                      {t.text}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex items-center gap-8">
              <button
                onClick={endCall}
                className="p-6 bg-red-500 rounded-full hover:bg-red-600 transition-all shadow-2xl shadow-red-500/40"
              >
                <PhoneOff className="w-8 h-8" />
              </button>
            </div>

            <p className="mt-12 text-blue-400 text-sm max-w-xs text-center">
              MindMate is listening. Speak naturally, we're here for you.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
