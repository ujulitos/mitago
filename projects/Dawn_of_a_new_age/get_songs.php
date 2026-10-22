<?php
header('Content-Type: application/json; charset=utf-8');

$songsDir = __DIR__ . '/songs';
$projectInfoFile = __DIR__ . '/projectInfo.json';

$albumData = [];
if (file_exists($projectInfoFile)) {
    $existing = json_decode(file_get_contents($projectInfoFile), true);
    if (is_array($existing)) {
        $albumData = $existing;
    }
}

$tracks = [];

if (is_dir($songsDir)) {
    $files = glob($songsDir . '/*.mp3');
    natsort($files);
    $files = array_values($files);

    foreach ($files as $index => $filePath) {
        $filename = basename($filePath);
        
        // Clean title from leading numbers (e.g. "01 It begins" -> "It begins")
        $nameWithoutExt = pathinfo($filename, PATHINFO_FILENAME);
        if (preg_match('/^\d+\s*(.+)$/', $nameWithoutExt, $matches)) {
            $title = trim($matches[1]);
        } else {
            $title = $nameWithoutExt;
        }

        $tracks[] = [
            'track_id' => $index,
            'track_filename' => $filename,
            'track_src' => 'songs/' . $filename,
            'track_title' => $title,
            'track_artist' => $albumData['artist_name']
        ];
    }
}

$albumData['tracks'] = $tracks;

// --- Process Discography (other_albums) Status & Covers ---
if (isset($albumData['other_albums']) && is_array($albumData['other_albums'])) {
    foreach ($albumData['other_albums'] as &$album) {
        $status = strtolower(trim($album['status'] ?? 'proximamente'));
        if ($status === 'pendind') {
            $status = 'pending';
        }

        $isPublished = ($status === 'published' || $status === 'active' || $status === 'publicado');

        if ($isPublished) {
            $album['status'] = 'published';
            if (empty($album['album_cover']) || $album['album_cover'] === 'assets/proximamente.png') {
                $album['album_cover'] = 'assets/album-cover.jpg';
            }
        } else {
            $album['status'] = $status;
            $album['album_cover'] = 'assets/proximamente.png';
        }
    }
    unset($album);
}

// Write updated data back to projectInfo.json
file_put_contents($projectInfoFile, json_encode($albumData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

// Output JSON
echo json_encode($albumData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
?>
