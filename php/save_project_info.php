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

$rawInput = file_get_contents('php://input');
if (empty($rawInput)) {
    echo json_encode([
        'success' => false,
        'error' => 'No se recibieron datos en el cuerpo de la solicitud.'
    ]);
    exit;
}

$decodedData = json_decode($rawInput, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    echo json_encode([
        'success' => false,
        'error' => 'El JSON proporcionado no es válido: ' . json_last_error_msg()
    ]);
    exit;
}

$projectFolder = isset($_GET['project_folder']) ? $_GET['project_folder'] : (isset($decodedData['project_folder']) ? $decodedData['project_folder'] : 'CameFromTheStars');
$projectFolder = preg_replace('/[^a-zA-Z0-9_-]/', '', $projectFolder);
if (empty($projectFolder)) {
    $projectFolder = 'CameFromTheStars';
}

$projectDir = dirname(__DIR__) . '/projects/' . $projectFolder;
$filePath = $projectDir . '/projectInfo.json';

// Create a timestamped backup before writing
if (file_exists($filePath)) {
    $backupPath = $projectDir . '/projectInfo.backup.json';
    @copy($filePath, $backupPath);
}

$formattedJson = json_encode($decodedData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if (file_put_contents($filePath, $formattedJson) !== false) {
    echo json_encode([
        'success' => true,
        'message' => 'El archivo projectInfo.json se ha actualizado correctamente.',
        'updated_at' => date('Y-m-d H:i:s')
    ]);
} else {
    echo json_encode([
        'success' => false,
        'error' => 'Error al escribir el archivo projectInfo.json en el servidor.'
    ]);
}
?>
