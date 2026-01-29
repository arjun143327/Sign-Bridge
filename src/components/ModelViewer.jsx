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

            // Scale to fit - slightly larger for the circle view
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 2.2 / maxDim;
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

        // Gentle rotation - removed for the card view to keep it steady forward
        // if (group.current) {
        //     group.current.rotation.y += delta * 0.1;
        // }
    });

    return (
        <group ref={group} position={[0, -1.8, 0]}>
            <primitive object={scene} />
        </group>
    );
}

// Loading Component
function LoadingSpinner() {
    return (
        <Html center>
            <div className="avatar-loading">
                <div className="spinner"></div>
            </div>
        </Html>
    );
}

// Main ModelViewer Component
export default function ModelViewer({
    isOpen,
    onClose,
    modelPath = '/avatar.glb',
    currentSign = null,
    isCaptionsOn,
    onToggleCaptions
}) {
    const [loadError, setLoadError] = useState(null);
    const [islMode, setIslMode] = useState(true); // Default to ISL active since this is the translator

    // Reset error when modal opens
    useEffect(() => {
        if (isOpen) {
            setLoadError(null);
        }
    }, [isOpen]);

    // Preload the model
    useEffect(() => {
        useGLTF.preload(modelPath);
    }, [modelPath]);

    return (
        <div className={`model-viewer-overlay ${!isOpen ? 'hidden' : ''}`}>
            <div className="ai-translator-card">
                {/* Header */}
                <div className="card-header">
                    <div className="header-status">
                        <span className="status-dot active"></span>
                        <span className="header-title">AI TRANSLATOR</span>
                    </div>
                    <button className="close-button" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>

                {/* Avatar Circle */}
                <div className="avatar-container">
                    <div className="avatar-circle">
                        {loadError ? (
                            <div className="avatar-error">
                                <p>Failed to load</p>
                            </div>
                        ) : (
                            <Canvas
                                camera={{ position: [0, 0, 4], fov: 45 }}
                                onError={(error) => {
                                    console.error('Canvas Error:', error);
                                    setLoadError('Canvas rendering failed');
                                }}
                            >
                                <Suspense fallback={<LoadingSpinner />}>
                                    <ambientLight intensity={0.8} />
                                    <directionalLight position={[2, 2, 5]} intensity={1.5} />
                                    <pointLight position={[-2, 1, -2]} intensity={0.5} color="#4a90e2" />
                                    <AvatarModel modelPath={modelPath} currentSign={currentSign} />
                                    <Environment preset="city" />
                                </Suspense>
                            </Canvas>
                        )}
                    </div>

                    {/* Shadow effect under the circle */}
                    <div className="avatar-shadow"></div>
                </div>

                {/* Controls Section */}
                <div className="controls-section">
                    <p className="status-message">Ready to start</p>

                    <div className="action-buttons">
                        <button
                            className={`action-btn speech-btn ${isCaptionsOn ? 'active' : ''}`}
                            onClick={onToggleCaptions}
                        >
                            <span className="btn-text">Speech</span>
                        </button>

                        <button
                            className={`action-btn isl-btn ${islMode ? 'active' : ''}`}
                            onClick={() => setIslMode(!islMode)}
                        >
                            <div className="hand-icon">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                                    <path d="M21 5.5c0-.83-.67-1.5-1.5-1.5S18 4.67 18 5.5v-3c0-.83-.67-1.5-1.5-1.5S15 1.67 15 2.5V5h-1V2.5c0-.83-.67-1.5-1.5-1.5S11 1.67 11 2.5v4.61c-.35-.07-.7-.11-1.06-.11-2.9 0-5.51 1.94-6.31 4.69l-.3 1.05c-.17.6.27 1.2.89 1.25.56.05 1.06-.34 1.18-.89l.34-1.63c.46-2.22 2.75-3.08 4.26-2.58V14c0 3.31 2.69 6 6 6s6-2.69 6-6V5.5z" />
                                </svg>
                            </div>
                            <span className="btn-text">ISL<br />Sign</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
