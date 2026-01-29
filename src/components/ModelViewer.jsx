import React, { Suspense, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import * as tf from '@tensorflow/tfjs';
import Webcam from 'react-webcam';
import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import './ModelViewer.css';

// --- OPTIMIZATION: SPEED UP LOADING ---
// 1. Disable slow safety checks
tf.enableProdMode();
// 2. Force WebGL Backend
tf.setBackend('webgl');

// Global cache to prevent reloading model
let cachedModel = null;

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
            playAnimation('idle');
        }
    }, [scene, animations]);

    // Handle Animation Triggers
    useEffect(() => {
        if (mixer.current && currentSign) {
            playAnimation(currentSign);
            const timeout = setTimeout(() => { 
                // Return to idle loop or stop after sign is done
                playAnimation('idle'); 
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

    return ( <group ref={group} position={[0, -1.8, 0]}> <primitive object={scene} /> </group> );
}

// --- LOADING SPINNER ---
function LoadingSpinner() {
    return ( <Html center> <div className="avatar-loading"><div className="spinner"></div></div> </Html> );
}

// --- MAIN VIEWER COMPONENT ---
export default function ModelViewer({
    isOpen,
    onClose,
    modelPath = '/ISL_hello2.glb',
    currentSign = null,
    isCaptionsOn,
    onToggleCaptions,
    transcript
}) {
    const [loadError, setLoadError] = useState(null);
    const [islMode, setIslMode] = useState(true);

    // AI State
    const [recogStatus, setRecogStatus] = useState("Initializing...");
    const [detectedText, setDetectedText] = useState("Waiting for sign...");
    const [sequence, setSequence] = useState([]); 

    const webcamRef = useRef(null);
    const canvasRef = useRef(null);
    const lastPredictTime = useRef(0); 

    // ⚠️ IMPORTANT: UPDATE THESE TO MATCH YOUR PYTHON FOLDERS
    const LABELS = ['Hello', 'Thanks', 'Yes']; 

    // Map signs to GLB files
    const signModelMap = {
        'Thank You': '/ISL_thankyou.glb',
        'Hello': '/ISL_hello2.glb',
    };
    const activeModelPath = (currentSign && signModelMap[currentSign]) ? signModelMap[currentSign] : modelPath;

    // 1. Initialize AI Model
    useEffect(() => {
        const initAI = async () => {
            if (!isOpen) return;

            if (cachedModel) {
                setRecogStatus("System Ready");
                console.log("✅ [SYSTEM] Using Cached Model");
                return;
            }

            try {
                setRecogStatus("Loading Model...");
                await tf.ready();
                const path = '/model/model.json'; 
                
                // strict: false handles weight mismatch warnings
                const model = await tf.loadLayersModel(path, { strict: false });
                
                cachedModel = model;
                setRecogStatus("System Ready");
                console.log("✅ [SYSTEM] MODEL LOADED & CONNECTED!");

            } catch (error) {
                console.error("❌ [SYSTEM] Connection Failed:", error);
                setRecogStatus("Failed to Load");
            }
        };
        initAI();
    }, [isOpen]);

    // 2. Setup Camera & MediaPipe
    useEffect(() => {
        if (!isOpen) return;

        const hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5,
        });

        hands.onResults(onResults);

        if (webcamRef.current && webcamRef.current.video) {
            const camera = new Camera(webcamRef.current.video, {
                onFrame: async () => {
                    if (webcamRef.current && webcamRef.current.video) {
                        await hands.send({ image: webcamRef.current.video });
                    }
                },
                width: 640,
                height: 480,
            });
            camera.start();
        }
    }, [isOpen]);

    // 3. Data Collection Loop (Handles 126 Inputs)
    const onResults = async (results) => {
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, 640, 480);
            
            // ⚠️ PADDING: Create array of 126 zeros to match your model input shape
            let frameData = new Array(126).fill(0);

            if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                const landmarks = results.multiHandLandmarks[0];
                
                // Draw visuals for debugging
                drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 5 });
                drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 2 });

                // Fill first 63 values (x,y,z for 21 points)
                for (let i = 0; i < landmarks.length; i++) {
                    frameData[i * 3] = landmarks[i].x;
                    frameData[i * 3 + 1] = landmarks[i].y;
                    frameData[i * 3 + 2] = landmarks[i].z;
                }

                // Add to sequence buffer
                setSequence(prevSeq => {
                    const newSeq = [...prevSeq, frameData];
                    return newSeq.length > 30 ? newSeq.slice(newSeq.length - 30) : newSeq;
                });
            }
        }
    };

    // 4. Prediction Logic (Throttled)
    useEffect(() => {
        const now = Date.now();
        // Run if buffer is full (30 frames) AND 500ms passed
        if (sequence.length === 30 && cachedModel && (now - lastPredictTime.current > 500)) {
            
            lastPredictTime.current = now;

            const predictSign = () => {
                tf.tidy(() => {
                    const input = tf.tensor3d([sequence]); 
                    const prediction = cachedModel.predict(input);
                    const resultIndex = prediction.argMax(-1).dataSync()[0];
                    const confidence = prediction.max().dataSync()[0];
                    
                    const word = LABELS[resultIndex] || "Unknown";
                    const confidencePct = (confidence * 100).toFixed(1);

                    // Console Log for Debugging
                    if (confidence > 0.8) {
                        console.log(`🤟 [DETECTED] ${word} (${confidencePct}%)`);
                        setDetectedText(word);
                    }
                });
            };
            predictSign();
        }
    }, [sequence]); 

    // Preload models logic
    useEffect(() => {
        useGLTF.preload(activeModelPath);
        useGLTF.preload('/ISL_thankyou.glb');
        useGLTF.preload('/ISL_hello2.glb');
    }, [activeModelPath]);


    if (!isOpen) return null;

    return (
        <div className={`model-viewer-overlay ${!isOpen ? 'hidden' : ''}`}>
            {/* Hidden Camera & Canvas for AI Processing */}
            <div style={{ position: 'absolute', top: 0, left: 0, opacity: 0.1, zIndex: 0, pointerEvents: 'none' }}>
                <Webcam ref={webcamRef} width={640} height={480} />
                <canvas ref={canvasRef} width={640} height={480} />
            </div>

            <div className="ai-translator-card">
                {/* Header */}
                <div className="card-header">
                    <div className="header-status">
                        <span className={`status-dot ${recogStatus.includes('Ready') ? 'active' : 'loading'}`}></span>
                        <span className="header-title">AI TRANSLATOR</span>
                    </div>
                    <button className="close-button" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                    </button>
                </div>

                {/* DETECTED TEXT DISPLAY */}
                <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.6)', padding: '10px', margin: '5px 20px', borderRadius: '10px', border: '1px solid #4a90e2' }}>
                    <h3 style={{ margin: 0, color: '#aaa', fontSize: '10px', textTransform: 'uppercase' }}>Detected Sign</h3>
                    <h2 style={{ margin: '2px 0 0 0', color: '#fff', fontSize: '24px', fontWeight: 'bold' }}>{detectedText}</h2>
                </div>

                {/* Avatar Circle */}
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
                </div>

                {/* Controls Section */}
                <div className="controls-section">
                    <p className="status-message">
                        {isCaptionsOn ? (transcript || 'Listening...') : 'Ready to start'}
                    </p>

                    <div className="action-buttons">
                        <button className={`action-btn speech-btn ${isCaptionsOn ? 'active' : ''}`} onClick={onToggleCaptions}>
                            <span className="btn-text">Speech</span>
                        </button>
                        <button className={`action-btn isl-btn ${islMode ? 'active' : ''}`} onClick={() => setIslMode(!islMode)}>
                            <div className="hand-icon">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M21 5.5c0-.83-.67-1.5-1.5-1.5S18 4.67 18 5.5v-3c0-.83-.67-1.5-1.5-1.5S15 1.67 15 2.5V5h-1V2.5c0-.83-.67-1.5-1.5-1.5S11 1.67 11 2.5v4.61c-.35-.07-.7-.11-1.06-.11-2.9 0-5.51 1.94-6.31 4.69l-.3 1.05c-.17.6.27 1.2.89 1.25.56.05 1.06-.34 1.18-.89l.34-1.63c.46-2.22 2.75-3.08 4.26-2.58V14c0 3.31 2.69 6 6 6s6-2.69 6-6V5.5z" /></svg>
                            </div>
                            <span className="btn-text">ISL<br />Sign</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}