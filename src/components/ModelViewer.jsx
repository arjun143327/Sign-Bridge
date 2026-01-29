import React, { Suspense, useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import Webcam from 'react-webcam';
import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { ISLClassifier } from '../utils/ISLClassifier'; // NEW: Import KNN Classifier
import preTrainedModel from '../isl_model.json'; // LOAD PRE-TRAINED TRAINING DATA
import './ModelViewer.css';

// --- AVATAR MODEL COMPONENT ---
function AvatarModel({ modelPath, currentSign }) {
    const group = useRef();
    const { scene, animations } = useGLTF(modelPath);
    const mixer = useRef();

    // Position Locking Logic (From your code)
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
            // Don't auto-play any animation - stay still until triggered
        }
    }, [scene, animations]);

    // Handle Animation Triggers
    useEffect(() => {
        if (mixer.current && currentSign) {
            playAnimation(currentSign);
            const timeout = setTimeout(() => {
                // Stop all animations after sign is done - stay still
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
            action.reset().fadeIn(0.5).play();
            mixer.current._actions.forEach(act => { if (act !== action) act.fadeOut(0.5); });
        }
    };

    useFrame((state, delta) => {
        if (mixer.current) mixer.current.update(delta);

        // Force lock every frame to prevent jumping
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
    const [loadError, setLoadError] = useState(null); // RESTORED
    const [isTraining, setIsTraining] = useState(false); // Toggle Training Mode
    const [trainingCounts, setTrainingCounts] = useState({}); // Track examples per class
    // const [trainingLabel, setTrainingLabel] = useState(null); // REMOVED: Old Hold-to-Train

    // NEW: Hands-Free Training State
    const [trainingState, setTrainingState] = useState('idle'); // 'idle' | 'countdown' | 'capturing'
    const [countdown, setCountdown] = useState(3);
    const [activeLabel, setActiveLabel] = useState(null);

    // AI State
    const [recogStatus, setRecogStatus] = useState("Initializing...");
    const [detectedText, setDetectedText] = useState("Waiting for sign...");
    const [handDetected, setHandDetected] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false); // NEW: Track camera status

    // LOAD MODEL ON STARTUP (LocalStorage > Bundled JSON)
    useEffect(() => {
        const load = () => {
            // 1. Try Local Storage (User's latest training)
            const saved = localStorage.getItem('isl-model');
            if (saved) {
                classifier.load(saved);
                setRecogStatus("Ready (Custom Model Loaded)");
                setTrainingCounts(classifier.getExampleCounts());
                console.log("Loaded Custom Model from LocalStorage");
            }
            // 2. Try Bundled JSON (Universal)
            else if (preTrainedModel) {
                try {
                    classifier.load(JSON.stringify(preTrainedModel));
                    setRecogStatus("Ready (Standard Model Loaded)");
                    setTrainingCounts(classifier.getExampleCounts());
                    console.log("Loaded Bundled Model from JSON");
                } catch (e) {
                    console.error("Failed to load bundled model", e);
                }
            }
        };
        load();
    }, []);

    // HANDS-FREE TRAINING FUNCTION
    const startTrainingSession = (label) => {
        if (trainingState !== 'idle') return;

        setActiveLabel(label);
        setTrainingState('countdown');
        setCountdown(3);

        // 3... 2... 1...
        let count = 3;
        const timer = setInterval(() => {
            count--;
            setCountdown(count);
            if (count === 0) {
                clearInterval(timer);
                setTrainingState('capturing'); // Start capturing

                // Capture for 3 seconds then stop
                setTimeout(() => {
                    setTrainingState('idle');
                    setActiveLabel(null);
                    setRecogStatus("Training Complete!");
                }, 3000);
            }
        }, 1000);
    };

    const webcamRef = useRef(null);
    const canvasRef = useRef(null);

    // REFS FOR STATE ACCESS INSIDE CALLBACKS (Fixes Stale Closure)
    const isTrainingRef = useRef(isTraining);
    const trainingStateRef = useRef(trainingState);
    const activeLabelRef = useRef(activeLabel);

    // Sync Refs
    useEffect(() => {
        isTrainingRef.current = isTraining;
        trainingStateRef.current = trainingState;
        activeLabelRef.current = activeLabel;
    }, [isTraining, trainingState, activeLabel]);

    // Map signs to GLB files
    const signModelMap = {
        'Thank You': '/ISL_thankyou.glb',
        'Hello': '/ISL_hello2.glb',
    };
    const activeModelPath = (currentSign && signModelMap[currentSign]) ? signModelMap[currentSign] : modelPath;

    // Load Saved Model
    useEffect(() => {
        const loadModel = async () => {
            if (!isOpen) return;

            try {
                const savedModel = localStorage.getItem('isl-model');
                if (savedModel) {
                    classifier.load(savedModel);
                    setTrainingCounts(classifier.getExampleCounts());
                    setRecogStatus("Ready (Custom Model Loaded)");
                    console.log("✅ Custom Model Loaded from Storage");
                } else {
                    setRecogStatus("No Training Data found. Please Train.");
                }
            } catch (err) {
                console.error("Failed to load custom model", err);
            }
        };
        loadModel();
    }, [isOpen]);

    // 2. Setup Camera & MediaPipe (Auto-Start when Ready)
    useEffect(() => {
        if (!isOpen || !isCameraReady || !webcamRef.current || !webcamRef.current.video) return;

        console.log('🔹 [DEBUG] Starting MediaPipe (Auto-Start)');
        const videoElement = webcamRef.current.video;

        const hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
            maxNumHands: 2, // Support 2 hands for ISL
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });

        hands.onResults(onResults);

        let lastFrameTime = 0;
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                const now = Date.now();
                // Throttle to ~10 FPS to prevent crash
                if (now - lastFrameTime >= 100) {
                    lastFrameTime = now;
                    if (webcamRef.current && webcamRef.current.video) {
                        await hands.send({ image: webcamRef.current.video });
                    }
                }
            },
            width: 640,
            height: 480,
        });
        camera.start();

        return () => {
            // Cleanup
            camera.stop();
        };
    }, [isOpen, isCameraReady]);

    // 3. Data Collection Loop (Handles 126 Inputs)
    const onResults = async (results) => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, 640, 480);

            // ⚠️ PADDING: Create array of 126 zeros to match your model input shape
            let frameData = new Array(126).fill(0);

            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const landmarks = results.multiHandLandmarks[0];
                console.log('🔹 [DEBUG] Hand detected, landmarks:', landmarks.length);

                // Draw visuals for debugging
                drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
                drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 2 });

                // PREPROCESSING: Handedness-aware mapping (Model trained on [Left, Right])
                // 126 features = 63 Left + 63 Right

                const handedness = results.multiHandedness[0].label; // "Left" or "Right"

                // landmarks already defined above
                const wrist = landmarks[0];

                // Determine offset: Left -> 0, Right -> 63
                const isRight = handedness === 'Right';
                const offset = isRight ? 63 : 0;

                console.log(`🔹 [DEBUG] Hand: ${handedness}, Offset: ${offset} (Relative Coords)`);

                for (let i = 0; i < landmarks.length; i++) {
                    // Relative measurements make detection position-invariant
                    const x = landmarks[i].x - wrist.x;
                    const y = landmarks[i].y - wrist.y;
                    const z = landmarks[i].z - wrist.z;

                    // Fill specific slot based on handedness
                    frameData[offset + i * 3] = x;
                    frameData[offset + i * 3 + 1] = y;
                    frameData[offset + i * 3 + 2] = z;
                }

                // 3. KNN Logic - Train or Predict
                // READ FROM REFS
                const _isTraining = isTrainingRef.current;
                const _trainingState = trainingStateRef.current;
                const _activeLabel = activeLabelRef.current; // Captured Label

                if (_isTraining && _trainingState === 'capturing' && _activeLabel) {
                    // Start Capture!
                    classifier.addExample(frameData, _activeLabel);

                    // Update UI counts
                    setTrainingCounts(prev => ({
                        ...prev,
                        [_activeLabel]: (prev[_activeLabel] || 0) + 1
                    }));
                    setRecogStatus(`Training... ${_activeLabel}`);

                } else if (!_isTraining) {
                    // Prediction Mode
                    const result = await classifier.predict(frameData);

                    if (result) {
                        const confidencePct = (result.confidence * 100).toFixed(0);
                        console.log(`🤟 [DETECTED] ${result.label} (${confidencePct}%)`);
                        setDetectedText(result.label);
                        setRecogStatus(`Detected: ${result.label} (${confidencePct}%)`);

                        // Send to Meeting
                        if (onHandSignDetected) {
                            onHandSignDetected(result.label);
                        }
                    }
                }
            } else {
                setHandDetected(false);
            }
        }
    };

    // Old LSTM Prediction Logic - REMOVED
    // KNN uses onResults directly for instant prediction

    // Preload models logic
    useEffect(() => {
        useGLTF.preload(activeModelPath);
        useGLTF.preload('/ISL_thankyou.glb');
        useGLTF.preload('/ISL_hello2.glb');
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

    if (!isOpen) return null;

    return (
        <div className={`model-viewer-overlay ${!isOpen ? 'hidden' : ''}`}>
            {/* Hidden Camera & Canvas for AI Processing - Runs silently in background */}
            {/* Hidden Camera & Canvas for AI Processing: Moved inside Training Panel for cleaner UI */}

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
                            style={{ marginLeft: '10px', padding: '4px 8px', fontSize: '10px', background: isTraining ? '#ff4081' : '#333', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            {isTraining ? 'OPN: TRAIN' : 'OPN: PREDICT'}
                        </button>
                    </div>
                    <button className="close-button" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                    </button>
                </div>

                {isTraining ? (
                    /* TRAINING UI */
                    <div className="training-panel" style={{ padding: '15px', color: 'white', textAlign: 'center', height: '300px', overflowY: 'auto', position: 'relative' }}>

                        {/* COUNTDOWN OVERLAY */}
                        {renderTrainingOverlay()}

                        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>TRAIN MODE (Click to Start 3s Timer)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                            {classifier.classes.map(label => (
                                <button
                                    key={label}
                                    onClick={() => startTrainingSession(label)} // Click starts timer
                                    disabled={trainingState !== 'idle'}
                                    style={{
                                        padding: '10px 5px',
                                        // Colors: Green for Active Capture, Yellow for Countdown, Grey for Idle
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
                                    localStorage.setItem('isl-model', classifier.save());
                                    alert('Model Saved to Browser!');
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
                ) : (
                    /* PREDICTION UI (Avatar) */
                    <div className="avatar-container">
                        <div className="avatar-circle">
                            {loadError ? (
                                <div className="avatar-error"><p>Failed to load</p></div>
                            ) : (
                                <Canvas camera={{ position: [0, 0, 4], fov: 45 }} onError={() => setLoadError('Canvas Error')}>
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
                )}

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