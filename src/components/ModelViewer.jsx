import React, { Suspense, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import * as tf from '@tensorflow/tfjs';
import Webcam from 'react-webcam';
// REMOVED IMPORTS that cause bundling errors
// We now access window.Hands, window.Camera, window.drawConnectors from CDN scripts in index.html
import { ISLClassifier } from '../utils/ISLClassifier';
import preTrainedModel from '../isl_model.json';
import './ModelViewer.css';

// --- AVATAR MODEL COMPONENT ---
function AvatarModel({ modelPath, currentSign }) {
    const group = useRef();
    const { scene, animations } = useGLTF(modelPath);
    const mixer = useRef();

    // Position Locking Logic
    const lockedPosition = useRef(new THREE.Vector3());
    const lockedScale = useRef(new THREE.Vector3());
    const isInitialized = useRef(false);

    useEffect(() => {
        if (scene) {
            if (!isInitialized.current) {
                // Calculate position/scale for the first model
                const box = new THREE.Box3().setFromObject(scene);
                const center = box.getCenter(new THREE.Vector3());
                scene.position.sub(center);

                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2.2 / maxDim;
                scene.scale.setScalar(scale);

                // Lock it
                lockedPosition.current.copy(scene.position);
                lockedScale.current.copy(scene.scale);
                isInitialized.current = true;
            } else {
                // Apply lock to subsequent models
                scene.position.copy(lockedPosition.current);
                scene.scale.copy(lockedScale.current);
            }
        }

        if (animations && animations.length > 0) {
            mixer.current = new THREE.AnimationMixer(scene);
        }
    }, [scene, animations]);

    // Handle Animation Triggers
    useEffect(() => {
        if (mixer.current && currentSign) {
            playAnimation(currentSign);
            const timeout = setTimeout(() => {
                mixer.current.stopAllAction();
            }, 3000);
            return () => clearTimeout(timeout);
        }
    }, [currentSign]);

    const playAnimation = (name) => {
        if (!mixer.current || !animations) return;
        const clip = animations.find(anim => anim.name.toLowerCase().includes(name.toLowerCase()))
            || animations.find(anim => anim.name.toLowerCase().includes('idle'))
            || animations[0];
        if (clip) {
            const action = mixer.current.clipAction(clip);
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.reset().fadeIn(0.5).play();
            mixer.current._actions.forEach(act => { if (act !== action) act.fadeOut(0.5); });
        }
    };

    useFrame((state, delta) => {
        if (mixer.current) mixer.current.update(delta);
        if (scene && isInitialized.current) {
            scene.position.copy(lockedPosition.current);
            scene.scale.copy(lockedScale.current);
        }
    });

    return (<group ref={group} position={[0, -1.8, 0]}> <primitive object={scene} /> </group>);
}

// --- LOADING SPINNER ---
function LoadingSpinner() {
    return (<Html center> <div className="avatar-loading"><div className="spinner"></div></div> </Html>);
}

// --- MAIN VIEWER COMPONENT ---
export default function ModelViewer({
    isOpen,
    onClose,
    modelPath = '/ISL_hello2.glb',
    currentSign = null,
    isCaptionsOn,
    onToggleCaptions,
    transcript,
    onHandSignDetected // NEW: callback to send detected sign to Meeting component
}) {
    // 1. Initialize Classifier
    const [classifier] = useState(new ISLClassifier());
    const [loadError, setLoadError] = useState(null);
    const [isTraining, setIsTraining] = useState(false);
    const [trainingCounts, setTrainingCounts] = useState({});

    // NEW: Hands-Free Training State
    const [trainingState, setTrainingState] = useState('idle'); // 'idle' | 'countdown' | 'capturing'
    const [countdown, setCountdown] = useState(3);
    const [activeLabel, setActiveLabel] = useState(null);
    const [newSignName, setNewSignName] = useState(""); // State for dynamically adding signs

    // AI State
    const [recogStatus, setRecogStatus] = useState("Initializing...");
    const [detectedText, setDetectedText] = useState("Waiting for sign...");
    const [handDetected, setHandDetected] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false);

    // We will initialize the AI entirely inside a single robust useEffect down below.
    // HANDS-FREE TRAINING FUNCTION
    const startTrainingSession = (label) => {
        if (trainingState !== 'idle') return;

        setActiveLabel(label);
        setTrainingState('countdown');
        setCountdown(3);

        let count = 3;
        const timer = setInterval(() => {
            count--;
            setCountdown(count);
            if (count === 0) {
                clearInterval(timer);
                setTrainingState('capturing');
                setTimeout(async () => {
                    setTrainingState('training_network');
                    setRecogStatus("Training Neural Network... Please Wait!");
                    
                    try {
                        await classifier.train();
                        setRecogStatus("Training Complete!");
                    } catch (e) {
                        console.error(e);
                        setRecogStatus("Training Failed");
                    }
                    
                    setTrainingState('idle');
                    setActiveLabel(null);
                }, 3000);
            }
        }, 1000);
    };

    const webcamRef = useRef(null);
    const canvasRef = useRef(null);
    const handsRef = useRef(null);
    const cameraRef = useRef(null);

    // NEW: Temporal Sequence Buffer (1D CNN)
    const TIME_STEPS = 20;
    const frameSequenceRef = useRef([]);
    const frameCounterRef = useRef(0); // Used to throttle AI inference and fix lag

    // Cooldown & Smoothing Refs
    const lastDetectionTime = useRef(0);
    const lastDetectedSignRef = useRef(null);
    const predictionBufferRef = useRef([]);
    const COOLDOWN_MS = 300; // Extremely fast global cooldown
    const SAME_SIGN_COOLDOWN_MS = 2000; // Prevent spamming the exact same sign
    const VOTING_WINDOW = 5; // Keep last 5 predictions
    const VOTING_THRESHOLD = 4; // Require 4/5 consensus to filter out chaotic transition frames
    const CONFIDENCE_THRESHOLD = 0.70; // Lower confidence allowed because voting provides the stability

    // REFS FOR STATE ACCESS INSIDE CALLBACKS
    const isTrainingRef = useRef(isTraining);
    const trainingStateRef = useRef(trainingState);
    const activeLabelRef = useRef(activeLabel);

    useEffect(() => {
        isTrainingRef.current = isTraining;
        trainingStateRef.current = trainingState;
        activeLabelRef.current = activeLabel;
    }, [isTraining, trainingState, activeLabel]);

    const signModelMap = {
        'Thank You': '/ISL_thankyou.glb',
        'Hello': '/ISL_hello2.glb',
        'Welcome': '/ISL_welcome.glb',
        'Our': '/ISL_our2.glb',
        'Team': '/ISL_team2.glb',
        'To': '/ISL_to.glb'
    };
    const activeModelPath = (currentSign && signModelMap[currentSign]) ? signModelMap[currentSign] : modelPath;

    // 1. Initialize AI Model & Load Data
    useEffect(() => {
        const initAI = async () => {
            if (!isOpen) return;

            try {
                setRecogStatus("Initializing TensorFlow...");
                await tf.ready();
                try {
                    await tf.setBackend('webgl');
                } catch (bgErr) {
                    console.warn("WebGL failed, falling back to CPU", bgErr);
                    await tf.setBackend('cpu');
                }
                console.log(`✅ TFJS Backend: ${tf.getBackend()}`);

                // Priority 1: Check localStorage first (User's custom training)
                const localModel = localStorage.getItem('isl-model');
                if (localModel) {
                    setRecogStatus("Loading Custom Model... Training network...");
                    await classifier.load(localModel);
                    setTrainingCounts(classifier.getExampleCounts());
                    setRecogStatus("Ready (Custom Model Loaded)");
                    console.log("Loaded Custom Model from LocalStorage", classifier.getExampleCounts());
                } 
                // Priority 2: Fallback to bundled JSON file
                else if (preTrainedModel && Object.keys(preTrainedModel).length > 0) {
                    setRecogStatus("Loading Bundled Model... Training network...");
                    await classifier.load(JSON.stringify(preTrainedModel));
                    setTrainingCounts(classifier.getExampleCounts());
                    setRecogStatus("Ready (Standard Model Loaded)");
                    console.log("Loaded Bundled Model from JSON", classifier.getExampleCounts());
                } 
                else {
                    setRecogStatus("System Ready (No Model Trained)");
                }
            } catch (error) {
                console.error("❌ [SYSTEM] AI Init Failed:", error);
                setRecogStatus(`Error: ${error.message}`);
            }
        };
        initAI();
    }, [isOpen, classifier]);

    // 2. Setup Camera & MediaPipe (Auto-Start when Ready)
    useEffect(() => {
        if (!isCameraReady || !webcamRef.current || !webcamRef.current.video) return;

        console.log('🔹 [DEBUG] Starting MediaPipe (Auto-Start)');

        // Wait for Global Scripts to Load
        if (!window.Hands || !window.Camera) {
            console.warn("MediaPipe globals not found! Retrying in 1s...");
            setTimeout(() => setIsCameraReady(true), 1000); // Hacky retry
            return;
        }

        const videoElement = webcamRef.current.video;

        // USA GLOBAL WINDOW.HANDS
        const hands = new window.Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        hands.onResults(onResults);
        handsRef.current = hands;

        // USE GLOBAL WINDOW.CAMERA
        const camera = new window.Camera(videoElement, {
            onFrame: async () => {
                if (webcamRef.current && webcamRef.current.video) {
                    await hands.send({ image: webcamRef.current.video });
                }
            },
            width: 640,
            height: 480,
        });
        camera.start();
        cameraRef.current = camera;

        return () => {
            if (cameraRef.current) cameraRef.current.stop();
            if (handsRef.current) handsRef.current.close();
        };
    }, [isOpen, isCameraReady]);

    // 3. Data Collection Loop
    const onResults = async (results) => {
        if (canvasRef.current && window.drawConnectors && window.drawLandmarks && window.HAND_CONNECTIONS) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, 640, 480);

            let frameData = new Array(126).fill(0);

            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                setHandDetected(true);
                const landmarks = results.multiHandLandmarks[0];

                // USE GLOBAL DRAWING UTILS
                window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
                window.drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 2 });

                const handedness = results.multiHandedness[0].label;
                const wrist = landmarks[0];
                const isRight = handedness === 'Right';
                const offset = isRight ? 63 : 0;

                for (let i = 0; i < landmarks.length; i++) {
                    // Round to 4 decimal places to massively reduce JSON storage size (prevents QuotaExceededError)
                    const x = Number((landmarks[i].x - wrist.x).toFixed(4));
                    const y = Number((landmarks[i].y - wrist.y).toFixed(4));
                    const z = Number((landmarks[i].z - wrist.z).toFixed(4));
                    frameData[offset + i * 3] = x;
                    frameData[offset + i * 3 + 1] = y;
                    frameData[offset + i * 3 + 2] = z;
                }

                // Add to temporal sequence buffer
                frameSequenceRef.current.push(frameData);
                if (frameSequenceRef.current.length > TIME_STEPS) {
                    frameSequenceRef.current.shift();
                }
                frameCounterRef.current += 1;

                // 3. Neural Network Logic - Train or Predict
                const _isTraining = isTrainingRef.current;
                const _trainingState = trainingStateRef.current;
                const _activeLabel = activeLabelRef.current;

                if (_isTraining && _trainingState === 'capturing' && _activeLabel) {
                    if (frameSequenceRef.current.length === TIME_STEPS) {
                        classifier.addExample([...frameSequenceRef.current], _activeLabel);
                        setTrainingCounts(prev => ({
                            ...prev,
                            [_activeLabel]: (prev[_activeLabel] || 0) + 1
                        }));
                        setRecogStatus(`Capturing Sequences... ${_activeLabel}`);
                    }

                } else if (!_isTraining) {
                    // Check if model has classes (training data exists)
                    if (Object.keys(classifier.getExampleCounts()).length > 0) {
                        // 1. Check Cooldown
                        if (Date.now() - lastDetectionTime.current < COOLDOWN_MS) {
                            return; // Ignore frames while in cooldown
                        }

                        // 2. Predict on full temporal sequence
                        if (frameSequenceRef.current.length === TIME_STEPS) {
                            // THROTTLE INFERENCE: Predict every 2nd frame (15 FPS) for responsive but light CPU usage
                            if (frameCounterRef.current % 2 !== 0) return;

                            const result = await classifier.predict(frameSequenceRef.current);
                            
                            // 3. VOTING CONSENSUS FILTER
                            if (result && result.confidence >= CONFIDENCE_THRESHOLD) {
                                predictionBufferRef.current.push(result.label);
                            } else {
                                // Push a 'null' if confidence is too low to break false consensus
                                predictionBufferRef.current.push("null");
                            }

                            if (predictionBufferRef.current.length > VOTING_WINDOW) {
                                predictionBufferRef.current.shift();
                            }

                            if (predictionBufferRef.current.length === VOTING_WINDOW) {
                                // Count frequencies of predictions
                                const counts = {};
                                predictionBufferRef.current.forEach(label => {
                                    counts[label] = (counts[label] || 0) + 1;
                                });
                                
                                // Find the most frequent label
                                let maxLabel = null;
                                let maxCount = 0;
                                for (const [label, count] of Object.entries(counts)) {
                                    if (count > maxCount && label !== "null") {
                                        maxCount = count;
                                        maxLabel = label;
                                    }
                                }

                                // If the dominant sign reaches consensus (e.g. 4 out of 5 frames)
                                if (maxCount >= VOTING_THRESHOLD) {
                                    const now = Date.now();
                                    // Fire if it's a NEW sign, or if 2 seconds passed for the SAME sign
                                    if (maxLabel !== lastDetectedSignRef.current || (now - lastDetectionTime.current > SAME_SIGN_COOLDOWN_MS)) {
                                        
                                        setDetectedText(maxLabel);
                                        setRecogStatus(`Detected: ${maxLabel} (Consensus)`);
                                        console.log(`[DEBUG] Sign detected (Voting): ${maxLabel} (${maxCount}/${VOTING_WINDOW})`);
                                        
                                        if (onHandSignDetected) {
                                            onHandSignDetected(maxLabel);
                                        }

                                        // Update refs
                                        lastDetectionTime.current = now;
                                        lastDetectedSignRef.current = maxLabel;
                                        
                                        // Clear only the voting buffer to prevent double-fire, keep frames intact!
                                        predictionBufferRef.current = [];
                                    }
                                }
                            }
                        }
                    } else {
                        setRecogStatus("No model loaded - Train signs first");
                    }
                }
            } else {
                setHandDetected(false);
                // We removed the immediate buffer clear here. MediaPipe sometimes drops a frame,
                // and clearing the buffer entirely destroys the sequence collection. 
                // Because we run at 30fps now, the old frames will flush out in < 0.6 seconds anyway.
            }
        }
    };

    // Preload models logic
    useEffect(() => {
        useGLTF.preload(activeModelPath);
        useGLTF.preload('/ISL_thankyou.glb');
        useGLTF.preload('/ISL_hello2.glb');
        useGLTF.preload('/ISL_welcome.glb');
        useGLTF.preload('/ISL_our2.glb');
        useGLTF.preload('/ISL_team2.glb');
        useGLTF.preload('/ISL_to.glb');
    }, [activeModelPath]);


    // UI RENDER HELPERS
    const renderTrainingOverlay = () => {
        if (trainingState === 'idle') return null;
        return (
            <div style={{
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.85)', color: 'white', padding: '30px', borderRadius: '15px',
                zIndex: 200, textAlign: 'center', minWidth: '300px'
            }}>
                <h2 style={{ fontSize: '32px', margin: '0 0 10px 0' }}>
                    {trainingState === 'countdown' ? `Get Ready: ${countdown}` : "TRAINING!"}
                </h2>
                <div style={{ fontSize: '18px', color: '#ccc' }}>
                    {trainingState === 'countdown' ? "Position your hands..." : (
                        <span>
                            Capturing "{activeLabel}" <br />
                            <strong style={{ color: '#00e676', fontSize: '24px' }}>
                                {trainingCounts[activeLabel] || 0} Examples
                            </strong>
                        </span>
                    )}
                </div>
            </div>
        );
    };

    // if (!isOpen) return null; // REMOVED: Prevent WebGL unmount destruction

    return (
        <div 
            className={`model-viewer-overlay ${!isOpen ? 'hidden' : ''}`}
            style={!isOpen ? { position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' } : {}}
        >
            <div className="ai-translator-card">
                {/* Header */}
                <div className="card-header">
                    <div className="header-status">
                        <span className={`status-dot ${recogStatus.includes('Ready') ? 'active' : 'loading'}`}></span>
                        <span className="header-title">AI TRANSLATOR</span>
                        {/* Training Toggle */}
                        <button
                            className="mode-toggle"
                            onClick={() => setIsTraining(!isTraining)}
                            style={{ marginLeft: '10px', padding: '4px 8px', fontSize: '10px', background: isTraining ? '#ff4081' : '#00e676', color: isTraining ? 'white' : 'black', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            {isTraining ? 'OPN: TRAIN' : 'AI Active'}
                        </button>
                    </div>
                    <button className="close-button" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                    </button>
                </div>

                {/* TRAINING UI */}
                <div className="training-panel" style={{ 
                    display: isTraining ? 'block' : 'none', 
                    padding: '15px', color: 'white', textAlign: 'center', height: '300px', overflowY: 'auto', position: 'relative' 
                }}>

                        {/* COUNTDOWN OVERLAY */}
                        {renderTrainingOverlay()}

                        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>TRAIN MODE (Click to Start 3s Timer)</h3>
                        
                        {/* NEW: Add Sign Input */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '15px', justifyContent: 'center' }}>
                            <input 
                                type="text" 
                                value={newSignName} 
                                onChange={(e) => setNewSignName(e.target.value)} 
                                placeholder="Enter new sign name..." 
                                style={{ padding: '8px', borderRadius: '4px', border: 'none', width: '60%', outline: 'none' }}
                            />
                            <button 
                                onClick={() => {
                                    if (newSignName.trim() && classifier.addClass(newSignName.trim())) {
                                        setNewSignName(""); // clear input
                                    } else if (!newSignName.trim()) {
                                        alert("Please enter a sign name.");
                                    } else {
                                        alert("Sign already exists!");
                                    }
                                }}
                                style={{ padding: '8px 12px', background: '#00e676', border: 'none', borderRadius: '4px', color: 'black', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                + Add Sign
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                            {classifier.classes.map(label => (
                                <button
                                    key={label}
                                    onClick={() => startTrainingSession(label)} // Click starts timer
                                    disabled={trainingState !== 'idle'}
                                    style={{
                                        padding: '10px 5px',
                                        background: activeLabel === label ? (trainingState === 'capturing' ? '#00e676' : '#ffeb3b') : '#444',
                                        color: activeLabel === label && trainingState === 'countdown' ? 'black' : 'white',
                                        border: '1px solid #555',
                                        borderRadius: '6px',
                                        cursor: trainingState === 'idle' ? 'pointer' : 'not-allowed',
                                        fontSize: '11px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        transition: 'all 0.2s ease',
                                        opacity: (trainingState !== 'idle' && activeLabel !== label) ? 0.3 : 1
                                    }}
                                >
                                    <span style={{ fontWeight: 'bold' }}>{label}</span>
                                    <span style={{ fontSize: '9px', opacity: 0.8 }}>{trainingCounts[label] || 0} Ex</span>
                                </button>
                            ))}
                        </div>

                        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                            <button
                                onClick={() => {
                                    try {
                                        localStorage.setItem('isl-model', classifier.save());
                                        alert('Model Saved to Browser!');
                                    } catch (e) {
                                        console.error("Save error", e);
                                        if (e.name === 'QuotaExceededError') {
                                            alert("Browser Storage limit reached! Try clearing old data or use the Download button instead.");
                                        } else {
                                            alert("Failed to save model: " + e.message);
                                        }
                                    }
                                }}
                                style={{ padding: '8px 16px', background: '#2196f3', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
                            >
                                💾 Save
                            </button>
                            <button
                                onClick={() => {
                                    const data = classifier.save();
                                    const blob = new Blob([data], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'isl_model.json';
                                    a.click();
                                }}
                                style={{ padding: '8px 16px', background: '#9c27b0', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
                            >
                                ⬇️ Download
                            </button>
                            <button
                                onClick={() => {
                                    if (window.confirm('Clear all training data?')) {
                                        classifier.clear();
                                        setTrainingCounts({});
                                        localStorage.removeItem('isl-model');
                                    }
                                }}
                                style={{ padding: '8px 16px', background: '#f44336', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
                            >
                                🗑️ Clear
                            </button>
                        </div>
                    </div>

                {/* PREDICTION UI (Avatar) */}
                <div className="avatar-container" style={{ 
                    position: isTraining ? 'absolute' : 'relative',
                    left: isTraining ? '-9999px' : 'auto',
                    opacity: isTraining ? 0 : 1,
                    pointerEvents: isTraining ? 'none' : 'auto'
                }}>
                    <div className="avatar-circle">
                        {loadError ? (
                            <div className="avatar-error"><p>Failed to load</p></div>
                        ) : (
                            <Canvas camera={{ position: [0, 0, 4], fov: 45 }} onError={(e) => { console.error(e); setLoadError('Canvas Error'); }}>
                                <Suspense fallback={<LoadingSpinner />}>
                                    <ambientLight intensity={0.8} />
                                    <directionalLight position={[2, 2, 5]} intensity={1.5} />
                                    <AvatarModel modelPath={activeModelPath} currentSign={currentSign} />
                                    <Environment preset="city" />
                                </Suspense>
                            </Canvas>
                        )}
                    </div>
                    <div className="avatar-shadow"></div>
                    <div style={{ textAlign: 'center', marginTop: '10px', color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>
                        {recogStatus}
                    </div>
                </div>

                {/* WEBCAM (Always Mounted for Detection, Visible only in Training) */}
                <div style={{
                    marginTop: '10px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: isTraining ? '2px solid #00e676' : 'none',
                    height: isTraining ? 'auto' : '0px',
                    opacity: isTraining ? 1 : 0,
                    transition: 'all 0.3s ease'
                }}>
                    <Webcam
                        ref={webcamRef}
                        width={320} // Width of card content
                        height={240}
                        mirrored={false}
                        onUserMedia={() => {
                            console.log("📷 Webcam Ready!");
                            setIsCameraReady(true);
                        }}
                        onUserMediaError={(e) => console.error("Webcam Error:", e)}
                        videoConstraints={{ width: 640, height: 480, facingMode: "user" }}
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                    />
                    <canvas ref={canvasRef} width={640} height={480} style={{ display: 'none' }} />
                </div>
            </div>
        </div>
    );
}