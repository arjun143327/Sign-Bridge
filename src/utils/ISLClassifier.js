import * as tf from '@tensorflow/tfjs';

const TIME_STEPS = 20;
const FEATURES = 126;

export class ISLClassifier {
    constructor() {
        this.classes = [
            'Hello', 'Welcome', 'Yes', 'No', 'Thank You', 'Sorry', 'To', 'Our', 'Team',
            'Sign', 'This', 'Indian', 'Is'
        ];
        this.xs = [];
        this.ys = [];
        this.model = this.buildModel();
        this.exampleCounts = {};
    }

    buildModel() {
        const model = tf.sequential();
        model.add(tf.layers.conv1d({
            inputShape: [TIME_STEPS, FEATURES],
            filters: 32,
            kernelSize: 3,
            activation: 'relu'
        }));
        model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
        model.add(tf.layers.conv1d({
            filters: 64,
            kernelSize: 3,
            activation: 'relu'
        }));
        model.add(tf.layers.maxPooling1d({ poolSize: 2 }));
        model.add(tf.layers.flatten());
        model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        model.add(tf.layers.dense({ units: this.classes.length, activation: 'softmax' }));
        
        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });
        
        return model;
    }

    // Add a training example (sequence is [20, 126])
    addExample(sequence, label) {
        if (!sequence || sequence.length !== TIME_STEPS) return;
        
        const labelIndex = this.classes.indexOf(label);
        if (labelIndex === -1) return;

        // CAP MAX EXAMPLES to prevent LocalStorage QuotaExceededError (5MB limit)
        // 60 examples is plenty for a 1D CNN to learn a sign effectively.
        const currentCount = this.exampleCounts[label] || 0;
        const MAX_EXAMPLES = 60;

        if (currentCount >= MAX_EXAMPLES) {
            return; // Ignore further training for this class to save space
        }

        this.xs.push(sequence);
        this.ys.push(labelIndex);
        
        this.exampleCounts[label] = currentCount + 1;
    }

    // Train the neural network
    async train() {
        if (this.xs.length === 0) return;
        
        const xsTensor = tf.tensor3d(this.xs, [this.xs.length, TIME_STEPS, FEATURES]);
        const ysTensor = tf.oneHot(tf.tensor1d(this.ys, 'int32'), this.classes.length);
        
        await this.model.fit(xsTensor, ysTensor, {
            epochs: 30,
            batchSize: 16,
            shuffle: true
        });
        
        xsTensor.dispose();
        ysTensor.dispose();
    }

    // Predict the current gesture
    async predict(sequence) {
        if (this.xs.length === 0 || sequence.length !== TIME_STEPS) {
            return null;
        }

        const activation = tf.tensor3d([sequence], [1, TIME_STEPS, FEATURES]);
        
        const result = this.model.predict(activation);
        const probabilities = await result.data();
        
        activation.dispose();
        result.dispose();
        
        const maxProb = Math.max(...probabilities);
        const labelIndex = probabilities.indexOf(maxProb);
        
        if (maxProb > 0.30) {
            return {
                label: this.classes[labelIndex],
                confidence: maxProb
            };
        }

        return null;
    }

    getExampleCounts() {
        return this.exampleCounts;
    }

    save() {
        // We save the dataset instead of the model because in-browser CNNs forget old classes if retrained on new ones without the full dataset.
        // Returning the dataset string lets us recreate and train the model instantly on load.
        return JSON.stringify({
            classes: this.classes,
            xs: this.xs,
            ys: this.ys
        });
    }

    async load(datasetStr) {
        if (!datasetStr) return;
        try {
            const datasetObj = JSON.parse(datasetStr);
            
            // 1. Safely restore classes if they exist in the JSON
            if (datasetObj.classes && Array.isArray(datasetObj.classes)) {
                this.classes = datasetObj.classes;
                this.model = this.buildModel(); // Rebuild with correct output dimensions
            }

            if (datasetObj.xs && datasetObj.ys && datasetObj.xs.length > 0) {
                this.xs = datasetObj.xs;
                this.ys = datasetObj.ys;
                
                // Safety fix for corrupted datasets where labels exceed classes length
                let maxIndex = Math.max(...this.ys);
                while (maxIndex >= this.classes.length) {
                    this.classes.push(`UnknownSign_${this.classes.length}`);
                }
                if (maxIndex >= this.model.outputShape[1]) {
                    this.model = this.buildModel(); // Rebuild again if we had to add fallback classes
                }

            } else {
                // Support legacy isl_model.json format: {"Hello": [flat_array], "Welcome": [flat_array]}
                this.xs = [];
                this.ys = [];
                const SEQUENCE_LENGTH = TIME_STEPS * FEATURES;
                
                for (const [label, flatArray] of Object.entries(datasetObj)) {
                    if (label === 'classes') continue; // Skip if it's the classes array
                    if (!this.classes.includes(label)) this.classes.push(label);
                    const labelIndex = this.classes.indexOf(label);
                    
                    for (let i = 0; i < flatArray.length; i += SEQUENCE_LENGTH) {
                        const flatSeq = flatArray.slice(i, i + SEQUENCE_LENGTH);
                        if (flatSeq.length === SEQUENCE_LENGTH) {
                            const sequence = [];
                            for (let t = 0; t < TIME_STEPS; t++) {
                                sequence.push(flatSeq.slice(t * FEATURES, (t + 1) * FEATURES));
                            }
                            this.xs.push(sequence);
                            this.ys.push(labelIndex);
                        }
                    }
                }
                // Update final model architecture to support any newly discovered classes
                this.model = this.buildModel(); 
            }
            
            // Rebuild example counts
            this.exampleCounts = {};
            this.ys.forEach(idx => {
                const label = this.classes[idx];
                if (label) {
                    this.exampleCounts[label] = (this.exampleCounts[label] || 0) + 1;
                }
            });
            
            if (this.xs.length > 0) {
                console.log(`[ISLClassifier] Loaded dataset with ${this.xs.length} sequences. Training...`);
                await this.train();
                console.log('[ISLClassifier] Model trained successfully from loaded data.');
            }
        } catch (e) {
            console.error('[ISLClassifier] Failed to load model:', e);
            throw e; // Bubble error to UI
        }
    }

    clear() {
        this.xs = [];
        this.ys = [];
        this.exampleCounts = {};
        this.model = this.buildModel(); // Reset model weights
    }

    // Dynamically add a new class to the model
    addClass(newLabel) {
        if (!newLabel || this.classes.includes(newLabel)) return false;
        
        // Add to classes array
        this.classes.push(newLabel);
        
        // Rebuild the model so the final Dense layer has the new number of classes
        this.model = this.buildModel();
        console.log(`[ISLClassifier] Added new class '${newLabel}'. Total classes: ${this.classes.length}`);
        return true;
    }
}
