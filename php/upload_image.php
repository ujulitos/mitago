<?php
header('Content-Type: application/json; charset=utf-8');

// Allow CORS if needed
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Access-Control-Allow-Methods: POST, OPTIONS");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode([
        'success' => false,
        'error' => 'Método de solicitud no permitido. Se requiere POST.'
    ]);
    exit;
}

if (!isset($_FILES['image_file']) || $_FILES['image_file']['error'] !== UPLOAD_ERR_OK) {
    $errCode = isset($_FILES['image_file']) ? $_FILES['image_file']['error'] : 'no_file';
    echo json_encode([
        'success' => false,
        'error' => 'Error al recibir el archivo de imagen. Código: ' . $errCode
    ]);
    exit;
}

$fileTmp = $_FILES['image_file']['tmp_name'];
$fileNameOriginal = $_FILES['image_file']['name'];
$fileExt = strtolower(pathinfo($fileNameOriginal, PATHINFO_EXTENSION));

$allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
if (!in_array($fileExt, $allowedExts)) {
    echo json_encode([
        'success' => false,
        'error' => 'Formato no permitido. Solo se aceptan imágenes JPG, PNG, WEBP o GIF.'
    ]);
    exit;
}

// Target filename: default is project_cover.jpg if specified or background upload
$targetName = isset($_POST['target_filename']) && !empty($_POST['target_filename'])
    ? basename($_POST['target_filename'])
    : 'project_cover.jpg';

// Force extension to .jpg if target is project_cover
if ($targetName === 'project_cover.jpg' || $targetName === 'project_cover') {
    $targetName = 'project_cover.jpg';
}

$projectFolder = isset($_POST['project_folder']) && !empty($_POST['project_folder'])
    ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_POST['project_folder'])
    : 'CameFromTheStars';
if (empty($projectFolder)) {
    $projectFolder = 'CameFromTheStars';
}

$assetsDir = dirname(__DIR__) . '/projects/' . $projectFolder . '/assets';
if (!is_dir($assetsDir)) {
    mkdir($assetsDir, 0755, true);
}

$targetPath = $assetsDir . '/' . $targetName;

if (move_uploaded_file($fileTmp, $targetPath)) {
    // Relative path for projectInfo.json
    $relativePath = 'assets/' . $targetName;

    echo json_encode([
        'success' => true,
        'message' => 'La imagen ' . $targetName . ' se ha subido correctamente.',
        'filePath' => $relativePath,
        'timestamp' => time()
    ]);
} else {
    echo json_encode([
        'success' => false,
        'error' => 'Error al mover la imagen subida al directorio assets.'
    ]);
}
?>
