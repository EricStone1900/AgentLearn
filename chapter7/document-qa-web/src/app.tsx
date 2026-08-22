import {
  useState,
} from "react";
import {
  createAssistantApi,
} from "./api/assistant-api.js";
import type {
  CurrentDocument,
} from "./api/contracts.js";
import {
  clientConfig,
} from "./config/client-config.js";
import {
  DocumentUpload,
} from "./components/document-upload.js";
import {
  DocumentQa,
} from "./components/document-qa.js";
import {
  LearningAssistant,
} from "./components/learning-assistant.js";
import {
  LearningProgress,
} from "./components/learning-progress.js";
import {
  LearningReport,
} from "./components/learning-report.js";

const assistantApi = createAssistantApi({
  clientOptions: {
    baseUrl: clientConfig.apiBaseUrl,
    defaultTimeoutMs: clientConfig.apiTimeoutMs,
  },
  uploadTimeoutMs: clientConfig.uploadTimeoutMs,
});

export function App() {
  const [currentDocument, setCurrentDocument] = useState<CurrentDocument | undefined>(
    undefined,
  );
  const [activityVersion, setActivityVersion] = useState(0);

  function refreshLearningProgress(): void {
    setActivityVersion((previous) => previous + 1);
  }

  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>

      <main id="main-content" className="app-shell" tabIndex={-1}>
      <section className="app-intro" aria-labelledby="app-title">
        <p className="eyebrow">智能学习工作台</p>

        <h1 id="app-title">{clientConfig.appTitle}</h1>

        <p>
          从一份 PDF 开始，建立你的可检索学习资料库。
        </p>
      </section>

      <DocumentUpload
        api={assistantApi}
        maxUploadBytes={clientConfig.maxUploadBytes}
        onUploaded={(result) => {
          setCurrentDocument(result.document);
          refreshLearningProgress();
        }}
      />

      <DocumentQa
        api={assistantApi}
        currentDocument={currentDocument}
        onAnswered={refreshLearningProgress}
      />

      <LearningAssistant
        chat={assistantApi.chat}
        addNote={assistantApi.addNote}
        onActivity={refreshLearningProgress}
      />

      <LearningProgress
        api={assistantApi}
        refreshKey={activityVersion}
      />

      <LearningReport
        api={assistantApi}
      />
      </main>
    </>
  );
}
