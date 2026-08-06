import * as knnClassifier from '@tensorflow-models/knn-classifier';
import * as tf from '@tensorflow/tfjs';

export class ISLClassifier {
    constructor() {
        this.classifier = knnClassifier.create();
        // The 9 supported classes (User removed 'Please')
        this.classes = [
            'Hello',
            'Welcome',
            'Yes',
            'No',
            'Thank You',
            'Sorry',
            'To',
            'Our',
            'Team'
        ];
    }

    // Add a training example
    addExample(features, label) {
        // features is the 126-float array or similar tensor
        const activation = tf.tensor(features);
        this.classifier.addExample(activation, label);

        // Dispose tensor to avoid memory leak
        activation.dispose();
    }

    // Predict the current gesture
    async predict(features) {
        if (this.classifier.getNumClasses() === 0) {
            return null;
        }

        const activation = tf.tensor(features);

        // Get prediction
        const result = await this.classifier.predictClass(activation);

        activation.dispose();

        // Return result if confidence is high enough (lowered threshold for better detection)
        if (result.confidences[result.label] > 0.6) {
            return {
                label: result.label,
                confidence: result.confidences[result.label]
            };
        }

        return null;
    }

    // Get count of examples per class
    getExampleCounts() {
        return this.classifier.getClassExampleCount();
    }

    // Save model to string (for localStorage)
    save() {
        const dataset = this.classifier.getClassifierDataset();
        const datasetObj = {};
        Object.keys(dataset).forEach((key) => {
            let data = dataset[key].dataSync();
            datasetObj[key] = Array.from(data);
        });
        return JSON.stringify(datasetObj);
    }

    // Load model from string
    load(datasetStr) {
        if (!datasetStr) return;

        try {
            const datasetObj = JSON.parse(datasetStr);
            const dataset = {};
            Object.keys(datasetObj).forEach((key) => {
                const flatData = datasetObj[key];
                if (Array.isArray(flatData) && flatData.length > 0 && flatData.length % 126 === 0) {
                    dataset[key] = tf.tensor(flatData, [flatData.length / 126, 126]);
                    console.log(`[ISLClassifier] Loaded class "${key}" with ${flatData.length / 126} examples`);
                } else {
                    console.warn(`[ISLClassifier] Skipping class "${key}": invalid data format (length: ${flatData?.length}, expected multiple of 126)`);
                }
            });
            if (Object.keys(dataset).length > 0) {
                this.classifier.setClassifierDataset(dataset);
                console.log('[ISLClassifier] Model loaded successfully, classes:', Object.keys(dataset));
            } else {
                console.warn('[ISLClassifier] No valid classes found in model data');
            }
        } catch (e) {
            console.error('[ISLClassifier] Failed to load model:', e);
        }
    }

    // Clear all training data
    clear() {
        this.classifier.clearAllClasses();
    }
}
