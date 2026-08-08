import { useState, useEffect, useRef } from 'react'
import Peer from 'peerjs'
import ModelViewer from './ModelViewer'
import './Meeting.css'

function Meeting({ meetingId, userId, onLeaveMeeting }) {
    const [isCameraOn, setIsCameraOn] = useState(true)
    const [isMicOn, setIsMicOn] = useState(true)
    const [isScreenSharing, setIsScreenSharing] = useState(false)
    const [isCaptionsOn, setIsCaptionsOn] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [isModelViewerOpen, setIsModelViewerOpen] = useState(false)
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false)
    const [detectedSign, setDetectedSign] = useState(null)
    
    // Derive the correct 3D model file based on the spoken sign
    const getModelPathForSign = (signText) => {
        if (!signText) return '/ISL_hello2.glb';
        const text = signText.toLowerCase();
        if (text === 'is') return '/ISL_IS.glb';
        if (text === 'sign') return '/ISL_SIGN(POSE).glb';
        if (text === 'this') return '/ISL_THIS.glb';
        if (text === 'indian') return '/ISL_indian.glb';
        if (text.includes('hello')) return '/ISL_hello2.glb';
        if (text.includes('thank')) return '/ISL_thankyou.glb';
        if (text.includes('welcome')) return '/ISL_welcome.glb';
        if (text.includes('our')) return '/ISL_our2.glb';
        if (text.includes('team')) return '/ISL_team2.glb';
        if (text.includes('to')) return '/ISL_to.glb';
        return '/ISL_hello2.glb'; // Default fallback
    };
    const currentModelPath = getModelPathForSign(detectedSign);
    const [peerId, setPeerId] = useState('')
    const [connectionStatus, setConnectionStatus] = useState('Connecting...')
    const [meetingDuration, setMeetingDuration] = useState(0)
    const [remoteActiveSpeaker, setRemoteActiveSpeaker] = useState(false)
    const activeSpeakerTimeoutRef = useRef(null)

    const localVideoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const localStreamRef = useRef(null)
    const peerInstance = useRef(null)
    const callInstance = useRef(null)
    const connInstance = useRef(null)

    const signBufferRef = useRef([])
    const signTimeoutRef = useRef(null)

    // Handle hand sign detection (Voice or Hand)
    const handleHandSignDetected = (signText, source = 'hand') => {
        console.log(`🤟 Sign Detected (${source}):`, signText);

        if (source === 'avatar-only') {
            // 1. TRIGGER AVATAR ANIMATION (Independent of subtitles)
            setDetectedSign(signText);

            // 2. SEND AVATAR TRIGGER TO REMOTE PEER
            if (connInstance.current && connInstance.current.open) {
                connInstance.current.send({ type: 'avatar-trigger', sign: signText });
            }

            // Reset avatar after 5 seconds
            setTimeout(() => {
                setDetectedSign(null);
            }, 5000);
        } else {
            // --- TRIGGER AVATAR TO MIRROR LOCAL HAND SIGN ---
            setDetectedSign(signText);
            
            // Reset avatar after 5 seconds so they can repeat the same sign
            setTimeout(() => {
                setDetectedSign(null);
            }, 5000);
            
            // --- SENTENCE ACCUMULATION FOR HAND SIGNS ---
            signBufferRef.current.push(signText);
            const currentSentence = signBufferRef.current.join(' ');
            
            setTranscript(`✋ ${currentSentence}`);
            setIsCaptionsOn(true);

            // Send partial sentence to peer immediately
            if (connInstance.current && connInstance.current.open) {
                connInstance.current.send({ type: 'transcript', text: currentSentence, source: 'hand' });
            }

            // Reset Pause Timer (2.0 seconds)
            if (signTimeoutRef.current) clearTimeout(signTimeoutRef.current);
            
            signTimeoutRef.current = setTimeout(() => {
                // Sentence is complete!
                const finalSentence = signBufferRef.current.join(' ');
                
                // --- TRIGGER TEXT-TO-SPEECH ---
                // We use the browser's built-in TTS to speak the finished sentence out loud!
                if ('speechSynthesis' in window) {
                    const utterance = new SpeechSynthesisUtterance(finalSentence);
                    utterance.rate = 0.9; // Speak slightly slower for clarity
                    utterance.pitch = 1.0;
                    window.speechSynthesis.speak(utterance);
                }

                // Clear buffer for the next sentence
                signBufferRef.current = [];
                
                // Clear the screen after an additional 3 seconds of showing the final sentence
                setTimeout(() => {
                    setTranscript('');
                }, 3000);

            }, 2000);
        }
    };

    // --- MEETING TIMER ---
    useEffect(() => {
        const timer = setInterval(() => {
            setMeetingDuration(prev => prev + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const formatTime = (seconds) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // --- VOICE RECOGNITION SETUP (DEEPGRAM) ---
    useEffect(() => {
        if (!isMicOn) return;

        let socket;
        let mediaRecorder;
        let audioStream;
        let isCancelled = false;

        const startDeepgram = async () => {
            try {
                // Request a specific audio stream for STT
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                if (isCancelled) {
                    audioStream.getTracks().forEach(track => track.stop());
                    return;
                }

                // Deepgram websocket URL (interim_results=true gets words as they are spoken)
                socket = new WebSocket('wss://api.deepgram.com/v1/listen?interim_results=true&punctuate=true', [
                    'token',
                    import.meta.env.VITE_DEEPGRAM_API_KEY
                ]);

                let lastDetectedTime = 0;
                const COOLDOWN_MS = 2000;

                socket.onopen = () => {
                    if (isCancelled) {
                        socket.close();
                        return;
                    }
                    console.log("🟢 Deepgram WebSocket Connected");
                    
                    // Cross-browser MediaRecorder fallback (Safari doesn't support audio/webm)
                    let mimeType = 'audio/webm';
                    if (!MediaRecorder.isTypeSupported(mimeType)) {
                        mimeType = 'audio/mp4';
                        if (!MediaRecorder.isTypeSupported(mimeType)) {
                            mimeType = ''; // Let browser pick default
                        }
                    }
                    
                    mediaRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
                    
                    mediaRecorder.addEventListener('dataavailable', event => {
                        if (event.data.size > 0 && socket.readyState === 1) {
                            socket.send(event.data);
                        }
                    });
                    mediaRecorder.start(250); // Send audio chunks every 250ms
                };

                socket.onmessage = (message) => {
                    const received = JSON.parse(message.data);
                    
                    // Deepgram JSON structure safely accessed
                    const transcript = received?.channel?.alternatives?.[0]?.transcript;

                    if (transcript) {
                        const latestText = transcript.trim();
                        
                        // ALWAYS DISPLAY SPEECH-TO-TEXT LOCALLY
                        setTranscript(`🗣️ ${latestText}`);
                        setIsCaptionsOn(true);
                        
                        // ALWAYS SEND RAW SPEECH TO REMOTE PEER
                        if (connInstance.current && connInstance.current.open) {
                            connInstance.current.send({ type: 'transcript', text: latestText, source: 'voice' });
                        }

                        // Debounce clearing of subtitles (wait 4 seconds of silence before hiding)
                        if (activeSpeakerTimeoutRef.current) clearTimeout(activeSpeakerTimeoutRef.current);
                        activeSpeakerTimeoutRef.current = setTimeout(() => setTranscript(''), 4000);

                        const now = Date.now();
                        if (now - lastDetectedTime < COOLDOWN_MS) return;

                        const latestFragment = latestText.toLowerCase();
                        const keywords = [
                            { word: 'hello', sign: 'Hello' },
                            { word: 'hi', sign: 'Hello' },
                            { word: 'thank', sign: 'Thank You' },
                            { word: 'thanks', sign: 'Thank You' },
                            { word: 'welcome', sign: 'Welcome' },
                            { word: 'our', sign: 'Our' },
                            { word: 'team', sign: 'Team' },
                            { word: 'to', sign: 'To' },
                            { word: 'two', sign: 'To' },
                            { word: 'too', sign: 'To' },
                            { word: 'sorry', sign: 'Sorry' },
                            { word: 'yes', sign: 'Yes' },
                            { word: 'no', sign: 'No' },
                            { word: 'indian', sign: 'Indian' },
                            { word: 'sign', sign: 'Sign' },
                            { word: 'this', sign: 'This' },
                            { word: 'is', sign: 'Is' }
                        ];

                        for (const k of keywords) {
                            if (latestFragment.includes(k.word)) {
                                console.log(`✅ MATCHED KEYWORD: ${k.word} -> ${k.sign}`);
                                handleHandSignDetected(k.sign, 'avatar-only');
                                lastDetectedTime = now;
                                break; 
                            }
                        }
                    }
                };

                socket.onclose = () => {
                    console.log("🔴 Deepgram WebSocket Closed");
                };
                
                socket.onerror = (error) => {
                    console.error("Deepgram Error:", error);
                };

            } catch (err) {
                console.error("Deepgram initialization failed:", err);
            }
        };

        startDeepgram();

        return () => {
            isCancelled = true;
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            if (socket) {
                socket.close();
            }
            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
            }
        };    }, [isMicOn]); // Re-bind if Mic toggles

    // 1. Initialize PeerJS & Local Stream
    useEffect(() => {
        const startMeeting = async () => {
            try {
                // Get Local Stream
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                localStreamRef.current = stream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                // Initialize Peer
                const peer = new Peer(userId);
                peerInstance.current = peer;

                peer.on('open', (id) => {
                    setPeerId(id);
                    setConnectionStatus("WAITING FOR OTHERS TO JOIN...");
                    console.log('My peer ID is: ' + id);

                    if (meetingId && meetingId !== userId) {
                        setConnectionStatus("CONNECTING...");

                        // A. Call for Video
                        const call = peer.call(meetingId, stream);
                        callInstance.current = call;

                        call.on('stream', (remoteStream) => {
                            if (remoteVideoRef.current) {
                                remoteVideoRef.current.srcObject = remoteStream;
                            }
                            setConnectionStatus(""); // Connected
                        });

                        // B. Connect for Data (Subtitles)
                        const conn = peer.connect(meetingId);
                        conn.on('open', () => {
                            console.log("Data connection opened!");
                            connInstance.current = conn;
                        });

                        // ADDED: Caller needs to listen for data too!
                        conn.on('data', (data) => {
                            console.log("Caller received data:", data);
                            if (data.type === 'transcript') {
                                setTranscript(`${data.source === 'hand' ? '✋' : '🗣️'} ${data.text}`);
                                setIsCaptionsOn(true);

                                setTimeout(() => {
                                    setTranscript('');
                                }, 5000);
                            } else if (data.type === 'avatar-trigger') {
                                setDetectedSign(data.sign);
                                setTimeout(() => setDetectedSign(null), 5000);
                            }
                        });
                    }
                });

                // Answer Incoming Calls (Video)
                peer.on('call', (call) => {
                    call.answer(stream);
                    callInstance.current = call;

                    call.on('stream', (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream;
                        }
                        setConnectionStatus("");
                    });
                });

                // Handle Incoming Data Connection (Subtitles/Signs)
                peer.on('connection', (conn) => {
                    conn.on('open', () => {
                        console.log("Data connection established!");
                        connInstance.current = conn;
                    });

                    conn.on('data', (data) => {
                        console.log("Received data:", data);
                        if (data.type === 'transcript') {
                            setTranscript(`${data.source === 'hand' ? '✋' : '🗣️'} ${data.text}`);
                            setIsCaptionsOn(true); // Auto-show

                            // Active Speaker Indicator
                            setRemoteActiveSpeaker(true);
                            if (activeSpeakerTimeoutRef.current) clearTimeout(activeSpeakerTimeoutRef.current);
                            activeSpeakerTimeoutRef.current = setTimeout(() => {
                                setRemoteActiveSpeaker(false);
                            }, 3000);

                            // Reset after 5 seconds
                            setTimeout(() => {
                                setTranscript('');
                            }, 5000);
                        } else if (data.type === 'avatar-trigger') {
                            setDetectedSign(data.sign);
                            setTimeout(() => setDetectedSign(null), 5000);
                        }
                    });
                });

                peer.on('error', (err) => {
                    console.error("Peer error:", err);
                    if (err.type === 'unavailable-id') {
                        setConnectionStatus("ID TAKEN");
                    } else {
                        setConnectionStatus("CONNECTION ERROR");
                    }
                });

            } catch (err) {
                console.error("Failed to start meeting:", err);
                setConnectionStatus("CAMERA ERROR");
            }
        };

        startMeeting();

        return () => {
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            if (peerInstance.current) {
                peerInstance.current.destroy();
            }
        };
    }, [userId, meetingId]);

    // Toggle Camera
    const toggleMic = () => {
        setIsMicOn(prev => {
            const newState = !prev;
            if (localStreamRef.current) {
                localStreamRef.current.getAudioTracks().forEach(track => {
                    track.enabled = newState;
                });
            }
            return newState;
        });
    };

    // Toggle Camera
    const toggleCamera = () => {
        setIsCameraOn(prev => {
            const newState = !prev;
            if (localStreamRef.current) {
                const videoTrack = localStreamRef.current.getVideoTracks()[0];
                if (videoTrack) {
                    videoTrack.enabled = newState;
                }
            }
            return newState;
        });
    };

    // Toggle Screen Share
    const toggleScreenShare = async () => {
        if (isScreenSharing) {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = stream.getVideoTracks()[0];

            if (localStreamRef.current) {
                const sender = callInstance.current?.peerConnection?.getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);

                localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
                localStreamRef.current.addTrack(videoTrack);
                if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
            }
            setIsScreenSharing(false);
        } else {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ cursor: true });
                const screenTrack = screenStream.getVideoTracks()[0];

                if (localStreamRef.current) {
                    const sender = callInstance.current?.peerConnection?.getSenders().find(s => s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);

                    localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
                    localStreamRef.current.addTrack(screenTrack);
                    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
                }

                screenTrack.onended = () => toggleScreenShare();
                setIsScreenSharing(true);
            } catch (err) {
                console.error("Screen share failed", err);
            }
        }
    };

    const toggleCaptions = () => {
        setIsCaptionsOn(!isCaptionsOn);
        // Don't clear transcript when toggling captions off - just hide/show
    };

    const copyMeetingId = () => {
        navigator.clipboard.writeText(meetingId);
        alert(`Meeting ID "${meetingId}" copied to clipboard!`);
    };

    const handleEndCall = () => {
        onLeaveMeeting();
    };

    return (
        <div className="meeting-container">
            {/* Header */}
            <div className="meeting-header">
                <div className="header-left">
                    <div className="meeting-timer">{formatTime(meetingDuration)}</div>
                    <div className="meeting-id">Meeting: {meetingId}</div>
                    {connectionStatus && (
                        <div className="connection-status-badge">
                            {connectionStatus}
                        </div>
                    )}
                </div>
                <div className="header-right" style={{ position: 'relative' }}>
                    <button 
                        className="participant-count" 
                        onClick={() => setIsParticipantsOpen(!isParticipantsOpen)}
                        style={{ cursor: 'pointer', background: isParticipantsOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', border: 'none', color: 'white', display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '16px', fontSize: '14px', fontWeight: 'bold' }}
                    >
                        👥 {peerId && connectionStatus === "" ? 2 : 1}
                    </button>
                    
                    {/* PARTICIPANTS POPOVER */}
                    {isParticipantsOpen && (
                        <div className="participants-popover" style={{
                            position: 'absolute', top: '110%', right: '0', background: '#1e1e1e', 
                            border: '1px solid #333', borderRadius: '8px', padding: '12px', width: '220px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 100, textAlign: 'left'
                        }}>
                            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#aaa' }}>Participants</h4>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px 0', fontSize: '14px' }}>
                                <li style={{ marginBottom: '6px', color: 'white' }}>👤 You (Host)</li>
                                {peerId && connectionStatus === "" && (
                                    <li style={{ color: 'white' }}>👤 Remote User</li>
                                )}
                            </ul>
                            <div style={{ borderTop: '1px solid #333', margin: '8px 0' }}></div>
                            <button 
                                onClick={copyMeetingId}
                                style={{ width: '100%', padding: '8px', background: '#0052cc', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                            >
                                📋 Copy Meeting ID
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="meeting-body">
                <div className="video-grid">
                    {/* REMOTE USER */}
                    <div className={`video-wrapper remote-video ${remoteActiveSpeaker ? 'active-speaker' : ''}`}>
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                        />
                        <div className="video-label">Remote User</div>
                    </div>

                    {/* LOCAL USER */}
                    <div className="video-wrapper local-video">
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            style={{ display: isCameraOn ? 'block' : 'none' }}
                        />
                        {!isCameraOn && (
                            <div className="avatar-placeholder">
                                <div className="avatar-circle">U</div>
                            </div>
                        )}
                        <div className="video-label">You</div>
                    </div>
                </div>
                
                {/* AI TRANSLATOR WIDGET */}
                <ModelViewer
                    isOpen={isModelViewerOpen}
                    onClose={() => setIsModelViewerOpen(false)}
                    modelPath={currentModelPath}
                    currentSign={detectedSign}
                    isCaptionsOn={isCaptionsOn}
                    onToggleCaptions={toggleCaptions}
                    transcript={transcript}
                    onHandSignDetected={handleHandSignDetected}
                    videoElementRef={localVideoRef}
                />
            </div>

            {transcript && (
                <div className="captions-overlay">
                    <div className="captions-text">{transcript}</div>
                </div>
            )}

            {/* CONTROLS */}
            <div className="controls-container">
                <button
                    className={`control-button ${isMicOn ? 'active' : 'inactive'}`}
                    onClick={toggleMic}
                    title={isMicOn ? 'Turn off microphone' : 'Turn on microphone'}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        {isMicOn ? (
                            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z M17.91 11c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" />
                        ) : (
                            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                        )}
                    </svg>
                </button>

                <button
                    className={`control-button ${isCameraOn ? 'active' : 'inactive'}`}
                    onClick={toggleCamera}
                    title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        {isCameraOn ? (
                            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                        ) : (
                            <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />
                        )}
                    </svg>
                </button>

                <div className="control-divider" />

                <button
                    className={`control-button ${isScreenSharing ? 'active-accent' : ''}`}
                    onClick={toggleScreenShare}
                    title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
                    </svg>
                </button>

                <div className="control-divider" />

                <button
                    className="control-button ai-trigger"
                    onClick={() => setIsModelViewerOpen(!isModelViewerOpen)}
                    title="Toggle AI Translator"
                    style={{
                        background: isModelViewerOpen ? '#e8f0fe' : '',
                        color: isModelViewerOpen ? '#1967d2' : ''
                    }}
                >
                    <span style={{ fontSize: '20px' }}>🤖</span>
                </button>

                <button
                    className={`control-button ${isCaptionsOn ? 'active-accent' : ''}`}
                    onClick={toggleCaptions}
                    title={isCaptionsOn ? 'Turn off captions' : 'Turn on captions'}
                    style={{
                        background: isCaptionsOn ? '#e8f0fe' : '',
                        color: isCaptionsOn ? '#1967d2' : ''
                    }}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" />
                    </svg>
                </button>

                <div className="control-divider" />

                <button
                    className="control-button end-call"
                    onClick={handleEndCall}
                    title="Leave call"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '28px', height: '28px' }}>
                        <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                    </svg>
                </button>
            </div>

        </div>
    )
}

export default Meeting