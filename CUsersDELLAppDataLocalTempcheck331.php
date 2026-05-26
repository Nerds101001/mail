<?php
$user = \App\Models\User::withoutGlobalScopes()->find(331);
echo 'User: ' . $user->name . PHP_EOL;
$codes = ['POST_GRADUATION_MARKSHEET', 'MASTER_CERTIFICATE'];
$docTypeIds = \App\Models\DocumentType::withoutGlobalScopes()->whereIn('code', $codes)->pluck('id');
echo 'DocType IDs: ' . $docTypeIds->implode(',') . PHP_EOL;
$docRequests = \App\Models\DocumentRequest::withoutGlobalScopes()->withTrashed()->where('user_id', 331)->whereIn('document_type_id', $docTypeIds)->get();
echo 'DRs: ' . $docRequests->count() . PHP_EOL;
foreach ($docRequests as $dr) { echo 'DR id=' . $dr->id . ' file=' . $dr->generated_file . ' deleted_at=' . $dr->deleted_at . PHP_EOL; }
$files = \Illuminate\Support\Facades\Storage::disk('public')->files('uploads/onboardingDocuments/331');
echo 'Files:' . PHP_EOL;
foreach ($files as $f) { echo '  ' . $f . PHP_EOL; }
