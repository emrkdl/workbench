import { useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * 프로미스 하나를 컴포넌트 수명에 묶는다.
 *
 * 라우트가 바뀌어 늦게 도착한 응답이 새 화면을 덮어쓰지 않도록 언마운트 시 결과를 버린다.
 * 데이터 요구가 이보다 복잡해지면(재검증, 낙관적 갱신) 그때 쿼리 라이브러리를 들인다.
 */
export function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let alive = true;
    setState({ data: null, error: null, loading: true });
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: Error) => alive && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
