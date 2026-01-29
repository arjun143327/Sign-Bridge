import { useState, useEffect, useRef } from 'react'
import './Meeting.css'

function Meeting({ meetingId, userId, onLeaveMeeting }) {
    const [isCameraOn, setIsCameraOn] = useState(true)
    const [isMicOn, setIsMicOn] = useState(true)
    const [isScreenSharing, setIsScreenSharing] = useState(false)
    const [isCaptionsOn, setIsCaptionsOn] = useState(false)
    const [transcript, setTranscript] = useState('')
    const localVideoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const localStreamRef = useRef(null)
    const timeoutRef = useRef(null)

    useEffect(() => {
        // Initialize local video stream
        startLocalVideo()

        return () => {
            // Cleanup
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop())
            }
        }
    }, [])

    useEffect(() => {
        let recognition = null;

        if (isCaptionsOn) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onresult = (event) => {
                    try {
                        const resultsLength = event.results.length;
                        if (resultsLength > 0) {
                            const latestResult = event.results[resultsLength - 1];
                            if (latestResult && latestResult[0]) {
                                const text = latestResult[0].transcript;
                                setTranscript(`You: ${text}`);

                                // Clear existing timeout
                                if (timeoutRef.current) {
                                    clearTimeout(timeoutRef.current);
                                }

                                // Set silence timeout
                                timeoutRef.current = setTimeout(() => {
                                    setTranscript('');
                                }, 3000);
                            }
                        }
                    } catch (err) {
                        console.error('Error processing speech result:', err);
                    }
                };

                recognition.onend = () => {

                    // Automatically restart if it stops unexpectedly
                    if (isCaptionsOn) {
                        setTimeout(() => {
                            if (isCaptionsOn && recognition) {
                                try {
                                    recognition.start();
                                } catch (e) {
                                    console.log('Recognition restart failed:', e);
                                }
                            }
                        }, 300);
                    }
                };

                recognition.onerror = (event) => {
                    if (event.error === 'not-allowed') {
                        setIsCaptionsOn(false);
                        alert('Microphone access denied.');
                    }
                };

                try {
                    recognition.start();
                } catch (e) {
                    console.error('Failed to start recognition:', e);
                }
            } else {
                alert('Speech recognition not supported.');
                setIsCaptionsOn(false);
            }
        }

        return () => {
            if (recognition) {
                recognition.onend = null; // Prevent restart loop on cleanup
                recognition.stop();
            }
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        }
    }, [isCaptionsOn])

    const startLocalVideo = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            })
            localStreamRef.current = stream
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream
            }
        } catch (error) {
            console.error('Error accessing media devices:', error)
        }
    }

    const toggleCamera = () => {
        if (localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0]
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled
                setIsCameraOn(videoTrack.enabled)
            }
        }
    }

    const toggleMic = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0]
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled
                setIsMicOn(audioTrack.enabled)
            }
        }
    }

    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true
                })
                setIsScreenSharing(true)

                // Stop screen sharing when user stops it from browser
                screenStream.getVideoTracks()[0].onended = () => {
                    setIsScreenSharing(false)
                }
            } catch (error) {
                console.error('Error sharing screen:', error)
            }
        } else {
            setIsScreenSharing(false)
        }
    }

    const toggleCaptions = () => {
        setIsCaptionsOn(!isCaptionsOn);
        if (!isCaptionsOn) setTranscript('');
    }

    const handleEndCall = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop())
        }
        onLeaveMeeting()
    }

    return (
        <div className="meeting">
            <div className="meeting-container">
                <div className="video-grid">
                    <div className="video-wrapper remote-video">
                        <video ref={remoteVideoRef} autoPlay playsInline />
                        <div className="video-label">Remote User</div>
                    </div>
                    <div className="video-wrapper local-video">
                        <video ref={localVideoRef} autoPlay playsInline muted />
                        <div className="video-label">You</div>
                        <div className="user-avatar">
                            <img src="/avatar.png" alt="User" />
                        </div>
                    </div>
                </div>

                {isCaptionsOn && transcript && (
                    <div className="captions-overlay">
                        <div className="captions-text">{transcript}</div>
                    </div>
                )}

                <div className="controls">
                    <button
                        className={`control-button ${isMicOn ? 'active' : 'inactive'}`}
                        onClick={toggleMic}
                        title={isMicOn ? 'Mute' : 'Unmute'}
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

                    <button
                        className={`control-button ${isScreenSharing ? 'active' : ''}`}
                        onClick={toggleScreenShare}
                        title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.11-.9-2-2-2H4c-1.11 0-2 .89-2 2v10c0 1.1.89 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z" />
                        </svg>
                    </button>

                    <button
                        className={`control-button ${isCaptionsOn ? 'active' : ''}`}
                        onClick={toggleCaptions}
                        title={isCaptionsOn ? 'Turn off captions' : 'Turn on captions'}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" />
                        </svg>
                    </button>

                    <button
                        className="control-button end-call"
                        onClick={handleEndCall}
                        title="End call"
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    )
}

export default Meeting
