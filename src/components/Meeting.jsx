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
    const [currentModelPath, setCurrentModelPath] = useState('/ISL_hello2.glb')
    const [detectedSign, setDetectedSign] = useState(null)
    const [peerId, setPeerId] = useState('')
    const [connectionStatus, setConnectionStatus] = useState('Connecting...')

    const localVideoRef = useRef(null)
    const remoteVideoRef = useRef(null)
    const localStreamRef = useRef(null)
    const peerInstance = useRef(null)
    const callInstance = useRef(null)

    // Handle hand sign detection from ML model
    const handleHandSignDetected = (signText) => {
        setTranscript(`✋ ${signText}`);
        setTimeout(() => {
            setTranscript('');
        }, 5000);
    };

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

                    // If we are joining someone else (meetingId !== userId), call them
                    if (meetingId && meetingId !== userId) {
                        setConnectionStatus("CONNECTING...");
                        const call = peer.call(meetingId, stream);
                        callInstance.current = call;

                        call.on('stream', (remoteStream) => {
                            if (remoteVideoRef.current) {
                                remoteVideoRef.current.srcObject = remoteStream;
                            }
                            setConnectionStatus(""); // Connected
                        });

                        call.on('error', (err) => {
                            console.error("Call error:", err);
                            setConnectionStatus("CALL FAILED");
                        });
                    }
                });

                // Answer Incoming Calls
                peer.on('call', (call) => {
                    call.answer(stream); // Answer with our stream
                    callInstance.current = call;

                    call.on('stream', (remoteStream) => {
                        if (remoteVideoRef.current) {
                            remoteVideoRef.current.srcObject = remoteStream;
                        }
                        setConnectionStatus(""); // Connected
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
            // Cleanup on unmount
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            if (peerInstance.current) {
                peerInstance.current.destroy();
            }
        };
    }, [userId, meetingId]); // Re-run if IDs change

    // Toggle Camera
    const toggleCamera = () => {
        if (localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsCameraOn(videoTrack.enabled);
            }
        }
    };

    // Toggle Mic
    const toggleMic = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMicOn(audioTrack.enabled);
            }
        }
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
        if (!isCaptionsOn) setTranscript('');
    };

    const handleEndCall = () => {
        onLeaveMeeting();
    };

    return (
        <div className="meeting-container">
            {/* Header Manually Styled to match Screenshot */}
            <div style={{
                position: 'absolute',
                top: 20,
                left: 20,
                zIndex: 100,
                color: 'white',
                fontFamily: 'sans-serif'
            }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
                    Meeting: {meetingId}
                </div>
                {connectionStatus && (
                    <div style={{
                        backgroundColor: '#fbbf24', /* yellow-400 */
                        color: '#000',
                        padding: '4px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'inline-block'
                    }}>
                        {connectionStatus}
                    </div>
                )}
            </div>

            <div className="video-grid">
                {/* REMOTE USER */}
                <div className="video-wrapper remote-video">
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
                        className={!isCameraOn ? 'hidden' : ''}
                    />
                    <div className="video-label">You</div>
                </div>
            </div>

            {isCaptionsOn && transcript && (
                <div className="captions-overlay">
                    <div className="captions-text">{transcript}</div>
                </div>
            )}

            {/* CONTROLS */}
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

                {/* ROBOT ICON - MATCHED TO SCREENSHOT */}
                <button
                    className="control-button ai-trigger"
                    onClick={() => setIsModelViewerOpen(true)}
                    title="Translate Sign Language"
                    style={{
                        background: 'linear-gradient(135deg, #60a5fa, #8b5cf6)', /* Blue-Purple matches icon */
                        border: '2px solid rgba(255,255,255,0.2)'
                    }}
                >
                    <span style={{ fontSize: '24px' }}>🤖</span>
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

            {/* 3D Model Viewer Modal */}
            <ModelViewer
                isOpen={isModelViewerOpen}
                onClose={() => setIsModelViewerOpen(false)}
                modelPath={currentModelPath}
                currentSign={detectedSign}
                isCaptionsOn={isCaptionsOn}
                onToggleCaptions={toggleCaptions}
                transcript={transcript}
                onHandSignDetected={handleHandSignDetected}
            />
        </div>
    )
}

export default Meeting