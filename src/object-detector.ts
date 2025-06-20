import sharp from 'sharp';
import * as ort from 'onnxruntime-node';

type Box = [number, number, number, number]; // [x1, y1, x2, y2]
export type DetectedBox = [number, number, number, number, string, number]; // [x1, y1, x2, y2, label, prob]

const yolo_classes = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse',
    'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase',
    'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard',
    'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
    'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant',
    'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
    'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

/**
 * Detects objects in an image using YOLOv8 model
 * @param buf - Image buffer to process
 * @returns Array of detected objects with their coordinates, labels and confidence scores
 */
export async function detect_objects_on_image(buf: Buffer): Promise<DetectedBox[]> {
    const [input, img_width, img_height] = await prepare_input(buf);
    const output = await run_model(input);
    return process_output(output, img_width, img_height);
}

/**
 * Calculates Intersection over Union (IoU) between two bounding boxes
 * @param box1 - First bounding box [x1, y1, x2, y2]
 * @param box2 - Second bounding box [x1, y1, x2, y2]
 * @returns IoU score between 0 and 1
 */
function iou(box1: Box, box2: Box): number {
    return intersection(box1, box2) / union(box1, box2);
}

/**
 * Calculates the union area of two bounding boxes
 * @param box1 - First bounding box [x1, y1, x2, y2]
 * @param box2 - Second bounding box [x1, y1, x2, y2]
 * @returns Total area of both boxes minus their intersection
 */
function union(box1: Box, box2: Box): number {
    const [box1_x1, box1_y1, box1_x2, box1_y2] = box1;
    const [box2_x1, box2_y1, box2_x2, box2_y2] = box2;
    const box1_area = (box1_x2 - box1_x1) * (box1_y2 - box1_y1);
    const box2_area = (box2_x2 - box2_x1) * (box2_y2 - box2_y1);
    return box1_area + box2_area - intersection(box1, box2);
}

/**
 * Calculates the intersection area of two bounding boxes
 * @param box1 - First bounding box [x1, y1, x2, y2]
 * @param box2 - Second bounding box [x1, y1, x2, y2]
 * @returns Area of intersection between the boxes
 */
function intersection(box1: Box, box2: Box): number {
    const [box1_x1, box1_y1, box1_x2, box1_y2] = box1;
    const [box2_x1, box2_y1, box2_x2, box2_y2] = box2;
    const x1 = Math.max(box1_x1, box2_x1);
    const y1 = Math.max(box1_y1, box2_y1);
    const x2 = Math.min(box1_x2, box2_x2);
    const y2 = Math.min(box1_y2, box2_y2);
    return (x2 - x1) * (y2 - y1);
}

/**
 * Prepares image for model input by resizing and normalizing
 * @param buf - Input image buffer
 * @returns Tuple containing normalized input array and original image dimensions
 */
async function prepare_input(buf: Buffer): Promise<[number[], number, number]> {
    const img = sharp(buf);
    const md = await img.metadata();
    const [img_width, img_height] = [md.width, md.height];
    const pixels = await img.removeAlpha()
        .resize({ width: 640, height: 640, fit: 'fill' })
        .raw()
        .toBuffer();

    const red: number[] = [], green: number[] = [], blue: number[] = [];
    for (let index = 0; index < pixels.length; index += 3) {
        red.push(pixels[index] / 255.0);
        green.push(pixels[index + 1] / 255.0);
        blue.push(pixels[index + 2] / 255.0);
    }

    const input = [...red, ...green, ...blue];
    return [input, img_width, img_height];
}

/**
 * Runs the YOLOv8 model inference
 * @param input - Normalized input array
 * @returns Model output tensor as Float32Array
 */
async function run_model(input: number[]): Promise<Float32Array> {
    const model = await ort.InferenceSession.create("model/yolov8m.onnx");
    const tensor = new ort.Tensor(Float32Array.from(input), [1, 3, 640, 640]);
    const outputs = await model.run({ images: tensor });
    return outputs["output0"].data as Float32Array;
}

/**
 * Processes model output to get detected objects with their coordinates and labels
 * @param output - Raw model output tensor
 * @param img_width - Original image width
 * @param img_height - Original image height
 * @returns Array of detected objects with coordinates, labels and confidence scores
 */
async function process_output(output: Float32Array, img_width: number, img_height: number): Promise<DetectedBox[]> {
    let boxes: DetectedBox[] = [];
    for (let index = 0; index < 8400; index++) {
        const [class_id, prob] = [...Array(80).keys()]
            .map(col => [col, output[8400 * (col + 4) + index]])
            .reduce((accum, item) => item[1] > accum[1] ? item : accum, [0, 0]);
        if (prob < 0.5) {
            continue;
        }
        const label = yolo_classes[class_id];
        const xc = output[index];
        const yc = output[8400 + index];
        const w = output[2 * 8400 + index];
        const h = output[3 * 8400 + index];
        const x1 = (xc - w / 2) / 640 * img_width;
        const y1 = (yc - h / 2) / 640 * img_height;
        const x2 = (xc + w / 2) / 640 * img_width;
        const y2 = (yc + h / 2) / 640 * img_height;
        boxes.push([x1, y1, x2, y2, label, prob]);
    }

    boxes = boxes.sort((box1, box2) => box2[5] - box1[5]);
    const result: DetectedBox[] = [];
    while (boxes.length > 0) {
        result.push(boxes[0]);
        boxes = boxes.filter(box => iou(box.slice(0, 4) as Box, boxes[0].slice(0, 4) as Box) < 0.7);
    }
    return result;
}