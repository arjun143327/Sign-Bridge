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

        // Return result if confidence is high enough
        if (result.confidences[result.label] > 0.8) {
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

        const datasetObj = JSON.parse(datasetStr);
        const dataset = {};
        Object.keys(datasetObj).forEach((key) => {
            dataset[key] = tf.tensor(datasetObj[key], [datasetObj[key].length / 126, 126]);
        });
        this.classifier.setClassifierDataset(dataset);
    }

    // Clear all training data
    clear() {
        this.classifier.clearAllClasses();
    }
}
