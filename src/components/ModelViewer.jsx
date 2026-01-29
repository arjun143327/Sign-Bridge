import React, { Suspense, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, OrbitControls, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import './ModelViewer.css';

// Avatar Model Component
function AvatarModel({ modelPath, currentSign }) {
    const group = useRef();
    const { scene, animations } = useGLTF(modelPath);
    const mixer = useRef();

    useEffect(() => {
        if (scene) {
            // Center the model
            const box = new THREE.Box3().setFromObject(scene);
            const center = box.getCenter(new THREE.Vector3());
            scene.position.sub(center);

            // Scale to fit
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 2.5 / maxDim;
            scene.scale.setScalar(scale);
        }

        // Initialize mixer
        if (animations && animations.length > 0) {
            mixer.current = new THREE.AnimationMixer(scene);
            playAnimation('idle');
        }
    }, [scene, animations]);

    // Handle sign changes
    useEffect(() => {
        if (currentSign && mixer.current) {
            playAnimation(currentSign);

            // Revert to idle after animation duration (approx 2s)
            const timeout = setTimeout(() => {
                playAnimation('idle');
            }, 2500);

            return () => clearTimeout(timeout);
        }
    }, [currentSign]);

    const playAnimation = (name) => {
        if (!mixer.current || !animations) return;

        // Find animation (fuzzy match)
        const clip = animations.find(anim =>
            anim.name.toLowerCase().includes(name.toLowerCase())
        ) || animations.find(anim =>
            anim.name.toLowerCase().includes('idle')
        ) || animations[0];

        if (clip) {
            const action = mixer.current.clipAction(clip);
            action.reset().fadeIn(0.5).play();

            // Fade out other actions
            mixer.current._actions.forEach(act => {
                if (act !== action) act.fadeOut(0.5);
            });
        }
    };


    // Animation update loop
    useFrame((state, delta) => {
        if (mixer.current) {
            mixer.current.update(delta);
        }

        // Gentle rotation
        if (group.current) {
            group.current.rotation.y += delta * 0.1;
        }
    });

    return (
        <group ref={group} position={[0, -1, 0]}>
            <primitive object={scene} />
        </group>
    );
}

// Loading Component
function LoadingSpinner() {
    return (
        <Html center>
            <div style={{
                color: 'white',
                fontSize: '18px',
                textAlign: 'center',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '20px', whiteSpace: 'nowrap' }}>Loading Avatar...</p>
            </div>
        </Html>
    );
}

// Error Component
function ErrorDisplay({ error, onClose }) {
    return (
        <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            textAlign: 'center',
            padding: '40px',
            background: 'rgba(255, 0, 0, 0.1)',
            borderRadius: '10px',
            border: '2px solid rgba(255, 0, 0, 0.3)'
        }}>
            <h3 style={{ marginBottom: '15px' }}>Failed to Load Avatar</h3>
            <p style={{ marginBottom: '20px', opacity: 0.8 }}>
                {error || 'Please check if avatar.glb exists in the public folder'}
            </p>
            <button
                onClick={onClose}
                style={{
                    padding: '10px 20px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    borderRadius: '5px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '16px'
                }}
            >
                Close
            </button>
        </div>
    );
}

// Main ModelViewer Component
export default function ModelViewer({ isOpen, onClose, modelPath = '/avatar.glb', currentSign = null }) {
    const [loadError, setLoadError] = useState(null);

    // Reset error when modal opens
    useEffect(() => {
        if (isOpen) {
            setLoadError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="model-viewer-overlay" onClick={onClose}>
            <div className="model-viewer-container" onClick={(e) => e.stopPropagation()}>

                {/* Close Button */}
                <button className="model-viewer-close" onClick={onClose} aria-label="Close">
                    <svg viewBox="0 0 24 24" fill="white" width="28" height="28">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                </button>

                {/* Header */}
                <div className="model-viewer-header">
                    <h2>AI Sign Language Assistant</h2>
                    <p>Interact with your 3D Avatar</p>
                </div>

                {/* 3D Canvas Area */}
                <div className="model-viewer-canvas-wrapper">
                    {loadError ? (
                        <ErrorDisplay error={loadError} onClose={onClose} />
                    ) : (
                        <>
                            <Canvas
                                camera={{ position: [0, 0.5, 4], fov: 50 }}
                                style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)' }}
                                onError={(error) => {
                                    console.error('Canvas Error:', error);
                                    setLoadError('Canvas rendering failed');
                                }}
                                gl={{
                                    antialias: true,
                                    alpha: false,
                                    preserveDrawingBuffer: true
                                }}
                            >
                                <Suspense fallback={<LoadingSpinner />}>
                                    {/* Lighting */}
                                    <ambientLight intensity={0.6} />
                                    <directionalLight
                                        position={[5, 5, 5]}
                                        intensity={1.2}
                                        castShadow
                                    />
                                    <pointLight position={[-5, 3, -5]} intensity={0.5} color="#4a90e2" />
                                    <spotLight
                                        position={[0, 10, 0]}
                                        angle={0.3}
                                        penumbra={1}
                                        intensity={0.8}
                                        castShadow
                                    />

                                    {/* Avatar Model */}
                                    <AvatarModel modelPath={modelPath} currentSign={currentSign} />

                                    {/* Camera Controls */}
                                    <OrbitControls
                                        enableZoom={true}
                                        enablePan={false}
                                        minDistance={2}
                                        maxDistance={8}
                                        maxPolarAngle={Math.PI / 1.8}
                                        minPolarAngle={Math.PI / 4}
                                        autoRotate={false}
                                        autoRotateSpeed={0.5}
                                    />

                                    {/* Environment Lighting */}
                                    <Environment preset="sunset" />
                                </Suspense>
                            </Canvas>

                            {/* Current Sign Display */}
                            {currentSign && (
                                <div className="current-sign-display">
                                    <span className="sign-label">Detected Sign:</span>
                                    <span className="sign-text">{currentSign}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer Instructions */}
                <div className="model-viewer-footer">
                    <div className="instruction-item">
                        <span className="instruction-icon">🖱️</span>
                        <span>Drag to Rotate</span>
                    </div>
                    <div className="instruction-item">
                        <span className="instruction-icon">🔍</span>
                        <span>Scroll to Zoom</span>
                    </div>
                    <div className="instruction-item">
                        <span className="instruction-icon">👋</span>
                        <span>ISL Signs Animated</span>
                    </div>
                </div>

            </div>
        </div>
    );
}

// Note: Preloading disabled to avoid module initialization errors
// If needed, preload can be called within a component useEffect
